Hello fellow minecrafters
This code was written by a russian hacker. Use at own peril.

Server code is the code that is used to run the server.

## To install
the server, run these commands with a console in the folder you wish to run Minecraft
1. If you have git use this `git clone "https://github.com/X-com/Backup-System.git" server`
   If you don't have git download and extract this file. "https://github.com/X-com/Backup-System/archive/server.zip"
2. `npm install`
3. `npm install -g ts-node`
4. Populate the user.jason file with password and login.
5. There is an optional discord bridge, a bot that posts messages to and from ingame chat into a discord channel of choice. To do so add in the json file information about server and channel IDs also add bot token with a. If not, remove the discord.json file.

## To run
the server type:
- `ts-node src -p3000` for survival
- `ts-node src -p3001` for creative
- `ts-node src -p3002` for survival copy

Example startup for running server with arguments
- `ts-node src -p3000 -- -Xmx2G -Xms2G -XX:+UseG1GC -Xss1M`

Client code is [hosted on this github](https://x-com.github.io/Backup-System/),
you only need to use it to login to a server of your choice with a specific IP and port.
Note that the port isn't the same as the port you play Minecraft on.
