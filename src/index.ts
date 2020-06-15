import { checkAuth } from "./users";
import fetch from "node-fetch";
import fs from "mz/fs";
import rp from "request-promise-native";
import jszip from "jszip";
import path, { join } from "path";
import { exec } from "child_process";
import WebSocket from "ws";
import fse from "fs-extra-promise";
import fspx from "fs";
import minimist from 'minimist';
import Discord, { TextChannel } from "discord.js";
import {Repository, Reference, Signature, Checkout, Status} from 'nodegit';

const args = minimist(process.argv.slice(2));
const fsp = fspx.promises;
let config:any;
try{
  config = JSON.parse(fs.readFileSync("./config/discord.json", "utf-8"));
}catch(e){}

const mcFolder = '../minecraft';
let repo:Repository;
// make signatures of committer and author
const author = Signature.now('Backup system', 'backup@mc.com');
(async () => {
  
  try{
    await fs.access(path.join(mcFolder, ".git"));
  }catch(e){
    await Repository.init(path.resolve(mcFolder), 0);
    repo = await Repository.open(path.resolve(mcFolder));
    // get index of all uncommitted files
    const index = await repo.refreshIndex();
    // create a snapshot of repo, get its reference
    await index.write();
    const tree = await index.writeTree();
    // create commit
    await repo.createCommit(
      // on currently checkouted branch
      'HEAD',
      // authored and committed by backup system
      author, author,
      // commit message
      'init',
      // reference to snapshot with files
      tree,
      // parent commit
      []
    );
  }
  repo = await Repository.open(path.resolve(mcFolder));
})();

try{
  fs.accessSync(mcFolder);
}catch(e){
  fs.mkdirSync(mcFolder);
}

// server just got started, waiting mc server to start
interface InitialState {
  type: "initial";
}

// server is starting
interface StartingState {
  type: "starting";
}

// mc server didn't start
interface FailedState {
  type: "failed";
}

// ms server is performing expected stop
interface StoppingState {
  type: "stopping";
}

// mc server is working
interface StartedState {
  type: "started";
  // function to stop the server
  // returns promise that will resolve when server finally stops
  stop: () => Promise<void>;
}

// saving backup
interface SavingState {
  type: "saving";
}

// restoring backup
interface RestoringState {
  type: "restoring";
}

type State =
  | InitialState
  | StartingState
  | StartedState
  | FailedState
  | StoppingState
  | SavingState
  | RestoringState;

// server's state
let state: State = { type: "initial" };
const setState = (newState: State) => {
  state = newState;
  // broadcast new server state to all the clients
  broadcast({ type: "state", value: state.type });
};

const getDate = () => {
  return new Date().toISOString()
      .replace(
          /(^\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}).*$/, 
          (_, d, t) => d + '-' + t.replace(/:/g, '-')
      );
};

const getCarpetLink = async () => {
  // get json from github api
  const response = await (await fetch(
    "https://api.github.com/repos/gnembon/carpetmod112/releases/latest"
  )).json();
  // lots of validation
  if (typeof response !== "object" || !("assets" in response)) {
    throw new Error("Github response failure 1");
  }
  const { assets } = response;
  if (
    typeof assets !== "object" ||
    !Array.isArray(assets) ||
    assets.length !== 1
  ) {
    throw new Error("Github response failure 2");
  }
  const asset = assets[0];
  if (!("browser_download_url" in asset)) {
    throw new Error("Github response failure 3");
  }
  const url = asset.browser_download_url;
  if (typeof url !== "string") {
    throw new Error("Github response failure 4");
  }
  return url;
};

const downloadMinecraft = async (force: boolean = false) => {
  const serverFile = path.join(mcFolder, "MinecraftServer.jar");
  // if force is set to true, don't check if the file already exists
  if (!force) {
    try {
      // try to read file. if doesn't exist, continue to downloading it
      return await fs.readFile(serverFile);
    } catch (e) {}
  }
  // get jar contents
  const url =
    "https://launcher.mojang.com/mc/game/1.12.2/server/886945bfb2b978778c3a0288fd7fab09d315b25f/server.jar";
  const response = await rp(url, { encoding: null });
  // save it to file
  await fs.writeFile(serverFile, response);
  // return file contents
  return response;
};

const downloadCarpet = async (force: boolean = false) => {
  const carpetFile = path.join(mcFolder, "carpet.jar");
  // if force is set to true, don't check if the file already exists
  if (!force) {
    try {
      // try to read file. if doesn't exist, continue to downloading it
      return await fs.readFile(carpetFile);
    } catch (e) {}
  }
  // get latest carpet link only if we don't use existing file
  const url = await getCarpetLink();
  // download carpet jar contents
  const response = await rp(url, { encoding: null });
  // save contents to disc
  await fs.writeFile(carpetFile, response);
  // return file contents
  return response;
};

const getMergedCarpet = async (force: boolean = false) => {
  const mergedFile = path.resolve(path.join(mcFolder, "server.jar"));
  const updateFolder = path.join(mcFolder, "update");
  try{
    await fs.access(updateFolder);
  }catch(e){
    await fs.mkdir(updateFolder);
  }
  const files = await fs.readdir(updateFolder)
  const carpetFile = files.find(file => file.match(/^Carpet\.[^.]+\.jar$/));
  if(carpetFile){
    const pathCarpetFile = path.join(updateFolder, carpetFile);
    await fse.copyAsync(pathCarpetFile, mergedFile);
    await fse.removeAsync(pathCarpetFile);
  }
  // if force is set to true, don't check if the file already exists
  if (!force) {
    try {
      await fs.access(mergedFile);
      return mergedFile;
    } catch (e) {}
  }
  // create empty archive
  const z = jszip();
  // get minecraft jar contents and extract it into archive
  await z.loadAsync(await downloadMinecraft());
  // get carpet jar and concatenate it into archive
  await z.loadAsync(await downloadCarpet(force));
  // write file to disc
  await fs.writeFile(mergedFile, await z.generateAsync({ type: "nodebuffer" }));
  // return concatenated jar path
  return mergedFile;
};

const getBackupList = async () => {
  const refs = await repo.getReferenceNames(Reference.TYPE.LISTALL);
  const result: string[] = [];
  for (const ref of refs) {
      const match = ref.match(/^refs\/heads\/(.*)+/);
      if (match && match[1] !== "master") {
          result.push(match[1]);
      }
  }
  return result.sort().reverse();
};

const signEula = async () => {
  const filePath = path.join(mcFolder, "eula.txt");
  try {
    await fs.access(filePath);
  } catch (e) {
    await fs.writeFile(
      filePath,
      "#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://account.mojang.com/documents/minecraft_eula).\n#Sat Jun 13 01:27:53 MSK 2020\neula=true\n"
    );
  }
};

const startServer = async (forceUpdate: boolean = false) => {
  // we shouldn't start a server when it's already running
  // exception is thrown outside of the handler, because it signifies a bug in code
  if (state.type !== "initial") {
    throw new Error("Cannot start a running server");
  }
  try {
    // set state to "starting" to avoid starting it second time in parallel
    setState({ type: "starting" });
    // sign eula
    await signEula();
    // wait 10 sec before starting server
    await new Promise((resolve) => setTimeout(resolve, 10000));
    // get jar file path
    const serverFullPath = await getMergedCarpet(forceUpdate);
    // run without gui
    const command = `java ${args._.join(" ")} -jar "${serverFullPath}" nogui`;
    // start child process with MC with CWD set to minecraft folder
    const child = exec(command, { cwd: mcFolder });
    const { stdout, stderr, stdin } = child;
    // if stdio of that process didn't open, something went wrong
    if (!stdin || !stdout || !stderr) {
      throw new Error("Cannot spawn child process");
    }
    // redirect server's stdin into mc's stdin, so that derp can control it
    process.stdin.pipe(stdin);
    // redirect mc's output to server's output, so that it's visible not only in logs
    stdout.pipe(process.stdout);
    stderr.pipe(process.stderr);
    // discord bridge for sending chat into discord
    const client = new Discord.Client();

    client.on("ready", () => {
      console.log("Connected discord bot");
      const guild = client.guilds.resolve(config.serverId);
      const channel = guild?.channels.resolve(config.channelId);
      if(!(channel instanceof TextChannel)) return;

      client.on("message", message => {
          if(channel.id !== message.channel.id) return;
          if(message.author.id === client.user?.id) return;

          const msg = [
            {
              text: `<${guild?.member(message.author)?.displayName}> `,
              color: "blue",
              hoverEvent: {
                action: "show_text",
                value: message.author.username + "#" + message.author.discriminator
              },
              clickEvent: {
                action: "suggest_command",
                value: "<@" + message.author.id + "> "
              }
            },
            {
              text: message.content,
              color: "white"
            }
          ];
          stdin.write(`/tellraw @a ${JSON.stringify(msg)}\n`);
      });

      stdout.on("data", data => {
        // #bridge
        const match = data.match(
          /\[\d\d:\d\d:\d\d\] \[Server thread\/INFO\]: <([^>]+)> ([^\n\r]+)[\r\n]/
        );
        if (match) {
          const [, name, message] = match;
          channel?.send(name + ": " + message);
        }
      });
    });

    if(config){
      try{
        client.login(config.botToken);
      }catch(e){
        console.error(e);
      }
    }
    // end of discord bridge
    // this promise will resolve when server stops
    const onClose = new Promise<void>((resolve, reject) => {
      // subscribe to mc server process stopping
      child.once("close", () => {
        client.destroy();
        if (state.type === "stopping") {
          // server was explicitly stopped
          setState({ type: "initial" });
        } else if (state.type === "started") {
          // server crashed -- should restart
          setState({ type: "initial" });
          // okay, restart it
          startServer();
        } else {
          // idk how that happened
          console.error(`Server crashed in unexpected state: ${state.type}`);
        }
        // resolve the promise
        resolve();
      });
    });
    // function to stop the server explicitly
    const stop = () => {
      // check whether server is really running at the moment
      if (state.type !== "started") {
        throw new Error(
          "Server isn't even running. Don't cache `stop` function in local variables!"
        );
      }
      // tell we expect it to stop, so that it's not automatically restarted
      setState({ type: "stopping" });
      // send /stop command to mc's stdin
      stdin.write("/stop\n");
      // return promise that resolves on server stop
      return onClose;
    };
    // now the server is officially running
    setState({ type: "started", stop });
  } catch (e) {
    // if mc was unable to start, set server's state back to initial
    // we don't try to restart it, because it's unlikely the problem is fixable by a retry
    setState({ type: "initial" });
    console.error(e);
  }
};

const restart = async (isUpdate: boolean) => {
  // if server is transitioning between states, it's not the best time to update
  if (state.type !== "started" && state.type !== "initial") {
    throw new Error("Server busy");
  }
  // is server is already started, stop it gracefully first
  if (state.type === "started") {
    await state.stop();
  }
  // now we start the server (probably with forced update)
  startServer(isUpdate);
};

const stop = async () => {
  // if server is transitioning between states, it's not the best time to update
  if (state.type !== "started" && state.type !== "initial") {
    throw new Error("Server busy");
  }
  // is server is already started, stop it gracefully first
  if (state.type === "started") {
    await state.stop();
  }
};

const worldPath = path.resolve(path.join(mcFolder, "world"));
const backupPath = path.resolve(path.join(mcFolder, "backup"));

const saveFiles = async (backupName: string) => {
  const name = getDate() + '.' + backupName;
  let c = 0;
  // count edited files
  await Status.foreach(repo, (file: string) => {
    ++c;
    return;
  });
  // if there are no files to be commited, exit
  if (c === 0) {
    return;
  }
  // get reference to top existing commit
  const head = await repo.getHeadCommit();
  // create new branch that has same commit on top
  await repo.createBranch(
      // branch name
      name,
      // commit on top of branch
      head,
      // do not overwrite if exists
      false,
  );
  // change current branch to newly created branch
  await fs.writeFile(path.join(path.resolve(mcFolder), '.git', 'HEAD'), `ref: refs/heads/${name}`);
  // get index of all uncommitted files
  const index = await repo.refreshIndex();
  // stage all changed files to be committed
  await Status.foreach(repo, (file: string) => index.addAll(file));
  // save index to disk
  await index.write();
  // create a snapshot of repo, get its reference
  const tree = await index.writeTree();
  // create commit
  await repo.createCommit(
      // on currently checkouted branch
      'HEAD',
      // authored and committed by backup system
      author, author,
      // commit message
      name,
      // reference to snapshot with files
      tree,
      // parent commit
      [head]
  );
}

const save = async (backupName: string) => {
  // if server is transitioning between states, it's not the best time to update
  if (state.type !== "started" && state.type !== "initial") {
    throw new Error("Server busy");
  }
  // is server is already started, stop it gracefully first
  if (state.type === "started") {
    await state.stop();
  }
  try {
    // block server state to avoid other requests starting it
    setState({ type: "saving" });

    // save stuffs
    await saveFiles(backupName);

    // unlock server state
    setState({ type: "initial" });
  } catch (e) {
    setState({ type: "initial" });
    console.error(e);
  }
  // broadcast that we got new backup
  broadcast({
    type: "backups",
    value: await getBackupList()
  });
  // now we start the server
  //startServer();
};

type Dimension = "overworld" | "nether" | "end";
const dimensions: Record<Dimension, string> = {
  overworld: "world/region/",
  nether: "world/DIM-1/region/",
  end: "world/DIM1/region/"
};
interface Region {
  dimension: Dimension;
  x: number;
  z: number;
}

const restore = async (backupName: string, regions: Region[]) => {
  // if server is transitioning between states, it's not the best time to update
  if (state.type !== "started" && state.type !== "initial") {
    throw new Error("Server busy");
  }
  // is server is already started, stop it gracefully first
  if (state.type === "started") {
    await state.stop();
  }
  try {
    // block server state to avoid other requests starting it
    setState({ type: "restoring" });
    if (regions.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
        // if world files were changed, create
        // backup of world at the moment of backup restore
        await saveFiles('rollback');
        // checkout old branch
        await repo.checkoutRef(await repo.getBranch(backupName));
    } else {
      // copy regions
      const regionPaths:string[] = [];
      for (const { dimension, x, z } of regions) {
        regionPaths.push(dimensions[dimension] + `r.${x}.${z}.mca`);
      }
      // if world files were changed, create
      // backup of world at the moment of backup restore
      await saveFiles('rollback');
      // get top commit in that backup
      const commit = await repo.getBranchCommit(backupName);
      // get snapshot from that commit
      const tree = await commit.getTree();
      // checkout files
      await Checkout.tree(
          repo,
          tree,
          {
              // overwrite files
              checkoutStrategy: Checkout.STRATEGY.FORCE,
              // list of files to checkout from backup
              paths: regionPaths
          },
      );
    }
    // unlock server state
    setState({ type: "initial" });
  } catch (e) {
    setState({ type: "initial" });
    console.error(e);
  }
  // broadcast that we got new backup
  broadcast({
    type: "backups",
    value: await getBackupList()
  });
  // now we start the server
  //startServer();
};

// pool of client connections
const clients = new Set<WebSocket>();
// broadcast a message to each client
const broadcast = (message: any) => {
  const encodedMessage = JSON.stringify(message);
  for (const client of clients) {
    client.send(encodedMessage);
  }
};

// regex for valid backup names
const nameRegex = /^[a-zA-Z0-9 .-]+$/;
// start websocket server
const port = args.p || 3000;
const wss = new WebSocket.Server({ port, host:"0.0.0.0"});
// subscribe to connections
wss.on("connection", (ws, req) => {
  // add client to pool
  clients.add(ws);
  // if connection got closed
  ws.on("close", () => {
    // remove client from the pool
    clients.delete(ws);
  });

  // ip of current user
  const ip = req.connection.remoteAddress;
  // username of current user (set after successfully checking "auth" message)
  let username: string | undefined = undefined;
  // logger factory
  const log = (level: string) => (message: string) => {
    console.error(JSON.stringify({ level, ip, username, message }));
  };
  // loggers for "info" and "error" loglevels
  const info = log("info");
  const error = log("error");
  // if connection with given client errored, log the error
  ws.on("error", e => {
    error(`Uncaught error ${e}`);
  });
  // when got a message in this connection
  ws.on("message", msg => {
    // websockets support binary messages, we don't use them
    if (typeof msg !== "string") {
      error("Binary message");
      ws.close();
      return;
    }
    // parse message string as json
    const message = JSON.parse(msg);
    // validation
    if (typeof message !== "object" || !("type" in message)) {
      error("Wrong message");
      ws.close();
      return;
    }
    const { type } = message;
    if (typeof type !== "string") {
      error("Wrong message");
      ws.close();
      return;
    }
    // "auth" message is the only message that doesn't require connection to be authorized
    // thus handled separately
    if (type === "auth") {
      // validation
      const { login, password } = message;
      if (typeof login !== "string" || typeof password !== "string") {
        error("Wrong message");
        return;
      }
      // check whether user exists
      // save username if authorization succeeded
      const success = (username = checkAuth(login, password));
      info(success ? "Authorized" : "Auth rejected");
      // respond to client with authorization result
      ws.send(
        JSON.stringify({
          type: "auth",
          success
        })
      );
      if (success) {
        // tell client about current server state to show in UI
        ws.send(JSON.stringify({ type: "state", value: state.type }));
        // also send list of available backups
        getBackupList().then(value =>
          ws.send(
            JSON.stringify({
              type: "backups",
              value
            })
          )
        );
      }
      return;
    }
    // a good client shouldn't request anything unless authorized
    if (!username) {
      info("Unauthorized access");
      ws.close();
      return;
    }
    // handle commands
    switch (type) {
      case "update": {
        restart(true);
        return;
      }
      case "restart": {
        restart(false);
        return;
      }
      case "stop": {
        stop();
        return;
      }
      case "save": {
        console.log("message", message);
        const backupName = message.name;
        if (typeof backupName !== "string" || !backupName.match(nameRegex)) {
          error("Wrong backup name");
          return;
        }
        save(backupName);
        return;
      }
      case "restore": {
        const backupName = message.name;
        if (typeof backupName !== "string" || !backupName.match(nameRegex)) {
          error("Wrong backup name");
          return;
        }
        const regions = message.regions;
        if (typeof regions !== "object" || !Array.isArray(regions)) {
          error("Region list is not array");
          return;
        }
        for (const region of regions) {
          if (typeof region !== "object") {
            error("Region id should be an object");
            return;
          }
          for (const axis of ["x", "z"]) {
            const axisValue = region[axis];
            if (typeof axisValue !== "number") {
              error("Region axis value not a number");
              return;
            }
          }
          const { dimension } = region;
          if (
            typeof dimension !== "string" ||
            !["overworld", "end", "nether"].includes(dimension)
          ) {
            error("Region world name is incorrect");
            return;
          }
        }
        restore(backupName, regions);
        return;
      }
      default: {
        return;
      }
    }
  });
});

// initial startup
startServer();