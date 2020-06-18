import "./app.css";
import React, {
  FC,
  useCallback,
  ChangeEventHandler,
  useState,
  MouseEventHandler,
  useRef
} from "react";
import {
  TextField,
  Button,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Input,
  IconButton,
  Dialog,
  DialogTitle,
  Select,
  MenuItem
} from "@material-ui/core";
import Description from "@material-ui/icons/Description";
import SettingsBackupRestore from "@material-ui/icons/SettingsBackupRestore";
import AddBox from "@material-ui/icons/AddBox";
import Backup from "@material-ui/icons/Backup";
import Alert from "@material-ui/lab/Alert";
import RemoveCircleOutline from "@material-ui/icons/RemoveCircleOutline";

export const App: FC = () => {
  const connection = useRef<WebSocket>();
  const [server, setServer] = useState("3000");
  const [ip, setIp] = useState(localStorage.getItem('ip') || "127.0.0.1");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [backupName, setBackupName] = useState("");
  const [serverState, setServerState] = useState("unknown");
  const [backupNameError, setBackupNameError] = useState(false);

  const handleServerChange = useCallback<ChangeEventHandler<{value:unknown}>>(
    event => {
      setServer(event.target.value as any);
    },
    []
  );
  
  const handleIpChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    event => {
      localStorage.setItem('ip', event.target.value)
      setIp(event.target.value);
    },
    []
  );

  const handleLoginChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    event => {
      setLogin(event.target.value);
    },
    []
  );

  const handlePasswordChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >(event => {
    setPassword(event.target.value);
  }, []);

  const handleLogin = useCallback<MouseEventHandler<HTMLButtonElement>>(
    event => {
      event.preventDefault();
      if (connection.current) {
        connection.current.close();
      }
      const conn = (connection.current = new WebSocket(`ws://${ip}:${server}/`));
      conn.onmessage = message => {
        const { data } = message;
        if (typeof data !== "string") {
          return;
        }
        const msg = JSON.parse(data);
        // no validation here: client-side problems will be apparent on the client
        switch (msg.type) {
          case "auth": {
            if (msg.success) {
              setError("");
              setAuthorized(true);
            } else {
              setError("Wrong user name or password");
            }
            return;
          }
          case "state": {
            setServerState(msg.value);
            return;
          }
          case "backups": {
            setBackups(msg.value);
            return;
          }
          default: {
            console.error("Got weird message", data);
            return;
          }
        }
      };
      conn.onopen = () => {
        conn.send(
          JSON.stringify({
            type: "auth",
            login,
            password
          })
        );
      };
      conn.onclose = () => {
        setAuthorized(false);
      }
    },
    [login, password, server, ip], 
  );

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [action, setAction] = useState(()=>()=>{});
  const handleConfirm = useCallback(()=>{
    action();
    setIsConfirmOpen(false);
  },[action]);
  const handleClose = useCallback(()=>{
    setIsConfirmOpen(false);
  },[]);

  const checkIsValid = useCallback((backupName: string) => {
    const isValid = backupName.match(/^[a-zA-Z0-9 '-]+$/);
    setBackupNameError(!isValid);
    return isValid;
  }, []);

  const handleSetBackupName = useCallback<ChangeEventHandler<HTMLInputElement>>(
    event => {
      const newValue = event.target.value;
      setBackupName(newValue);
      checkIsValid(newValue);
    },
    [checkIsValid]
  );

  const handleUpdate = useCallback<MouseEventHandler<HTMLButtonElement>>(
    event => {
      event.preventDefault();
      setIsConfirmOpen(true);
      setAction(()=>()=>{
        const conn = connection.current;
        if (!conn) {
          return;
        }
        conn.send(
          JSON.stringify({
            type: "update"
          })
        );
      })
    },
    []
  );

  const handleRestart = useCallback<MouseEventHandler<HTMLButtonElement>>(
    event => {
      event.preventDefault();
      setIsConfirmOpen(true);
      setAction(()=>()=>{
        const conn = connection.current;
        if (!conn) {
          return;
        }
        conn.send(
          JSON.stringify({
            type: "restart"
          })
        );
      })
    },
    []
  );

  const handleStop = useCallback<MouseEventHandler<HTMLButtonElement>>(
    event => {
      event.preventDefault();
      setIsConfirmOpen(true);
      setAction(()=>()=>{
        const conn = connection.current;
        if (!conn) {
          return;
        }
        conn.send(
          JSON.stringify({
            type: "stop"
          })
        );
      });
    },
    []
  );

  const backupNameRef = useRef<HTMLInputElement>(null);
  const handleSave = useCallback<MouseEventHandler<HTMLButtonElement>>(
    event => {
      event.preventDefault();
      if (!checkIsValid(backupName)) {
        if (backupNameRef.current) {
          backupNameRef.current.focus();
        }
        return;
      }
      setIsConfirmOpen(true);
      setAction(()=>()=>{
        const conn = connection.current;
        if (!conn) {
          return;
        }
        conn.send(
          JSON.stringify({
            type: "save",
            name: backupName
          })
        );
      })
    },
    [backupName, checkIsValid]
  );

  const handleRestore = useCallback((name: string, regions: Region[]) => {
    const conn = connection.current;
    if (!conn) {
      return;
    }
    conn.send(
      JSON.stringify({
        type: "restore",
        name,
        regions
      })
    );
  }, []);

  return (
    <div className="app">
      {authorized ? null : (
        <form noValidate autoComplete="off">
          <Paper className="app__form">
            <TextField
              className="app__input"
              required
              label="Ip"
              value={ip}
              onChange={handleIpChange}
            />
            <Select className="app__input" required label="Server" value={server} onChange={handleServerChange}>
              <MenuItem value="3000">Survival</MenuItem>
              <MenuItem value="3001">Creative</MenuItem>
              <MenuItem value="3002">Survival Copy</MenuItem>
            </Select>
            <TextField
              className="app__input"
              required
              label="Login"
              value={login}
              onChange={handleLoginChange}
            />
            <TextField
              className="app__input"
              required
              label="Password"
              type="password"
              value={password}
              onChange={handlePasswordChange}
            />
            <div className="app__button">
              <Button
                type="submit"
                variant="contained"
                color="primary"
                onClick={handleLogin}
              >
                Log in
              </Button>
            </div>
          </Paper>
        </form>
      )}
      {error ? (
        <Alert className="app__alert" severity="error">
          {error}
        </Alert>
      ) : null}
      {authorized ? (
        <Paper className="app__form">
          <div className="app__second">
            <div className="app__button">
              <Button
                className="app__button2"
                variant="contained"
                color="primary"
                onClick={handleUpdate}
              >
                Update carpet
              </Button>
              <Button
                className="app__button2"
                variant="contained"
                color="primary"
                onClick={handleRestart}
              >
                Restart
              </Button>
              <Button
                className="app__button2"
                variant="contained"
                color="primary"
                onClick={handleStop}
              >
                Stop
              </Button>
              <ConfirmDialog onConfirm={handleConfirm} onClose={handleClose} isOpen={isConfirmOpen}/>
              <div className="app__server-state">{serverState}</div>
            </div>
            <List>
              <ListItem>
                <ListItemIcon>
                  <AddBox />
                </ListItemIcon>
                <ListItemText>
                  <Input
                    inputRef={backupNameRef}
                    placeholder="Backup name"
                    value={backupName}
                    error={backupNameError}
                    onChange={handleSetBackupName}
                  />
                </ListItemText>
                <IconButton title="Save backup" onClick={handleSave}>
                  <Backup />
                </IconButton>
              </ListItem>
              {backups.map((backup, key) => (
                <BackupRow
                  key={key}
                  backup={backup}
                  onRestore={handleRestore}
                />
              ))}
            </List>
          </div>
        </Paper>
      ) : null}
    </div>
  );
};

type BackupRowProps = {
  backup: string;
  onRestore: (name: string, regions: Region[]) => void;
};

const BackupRow: FC<BackupRowProps> = ({ backup, onRestore }) => {
  const [isDialogOpen, setDialogOpen] = useState(false);
  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
  }, []);
  const handleDialogOpen = useCallback(() => {
    setDialogOpen(true);
  }, []);
  return (
    <>
      <ListItem button>
        <ListItemIcon>
          <Description />
        </ListItemIcon>
        <ListItemText primary={backup} />
        <IconButton title="Restore from backup" onClick={handleDialogOpen}>
          <SettingsBackupRestore />
        </IconButton>
      </ListItem>
      <RestoreDialog
        backup={backup}
        isOpen={isDialogOpen}
        onClose={handleDialogClose}
        onRestore={onRestore}
      />
    </>
  );
};

type ConfirmDialogProps = {
  onClose: () => void;
  onConfirm: () => void;
  isOpen: boolean;
}

const ConfirmDialog: FC<ConfirmDialogProps> = ({
  onClose, onConfirm, isOpen
}) => {
  return (
    <Dialog onClose={onClose} open={isOpen} className="dialog">
      <div className="dialog__inner">
        <div className="dialog__confirm">
          <div className="dialog__text">
            Are you sure?
          </div>
          <div className="dialog__buttons">
            <Button
              className="dialog__yes"
              type="submit"
              variant="contained"
              color="primary"
              onClick={onConfirm}
            >
              I'm sure
            </Button>
            <Button
              className="dialog__no"
              variant="contained"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

type DialogProps = {
  backup: string;
  isOpen: boolean;
  onClose: () => void;
  onRestore: (name: string, regions: Region[]) => void;
};

type Dimension = "overworld" | "nether" | "end";
interface Region {
  dimension: Dimension;
  x: number;
  z: number;
}

const showRegion = (region: Region): string => {
  const { dimension, x, z } = region;
  return `${dimension} ${x} ${z}`;
};

const RestoreDialog: FC<DialogProps> = ({
  backup,
  isOpen,
  onClose,
  onRestore
}) => {
  const [x, xError, handleSetX, validateX] = useNumericInput();
  const [z, zError, handleSetZ, validateZ] = useNumericInput();

  const [dimension, setDimension] = useState<Dimension>("overworld");
  const handleSetDimension = useCallback<
    ChangeEventHandler<{
      value: unknown;
    }>
  >(event => {
    setDimension(event.target.value as Dimension);
  }, []);

  const [regions, setRegions] = useState<Region[]>([]);
  const handleAddRegion = useCallback(() => {
    if (!validateX(x) || !validateZ(z)) {
      return;
    }
    setRegions([
      ...regions,
      {
        dimension,
        x: parseInt(x, 10),
        z: parseInt(z, 10)
      }
    ]);
  }, [regions, dimension, x, z, validateX, validateZ]);

  const handleRemoveRegion = useCallback(
    (id: number) => {
      const newRegions = [...regions];
      newRegions.splice(id, 1);
      setRegions(newRegions);
    },
    [regions]
  );

  const [showConfirm, setShowConfirm] = useState(false);
  const handleRestore = useCallback(() => {
    onClose();
    onRestore(backup, regions);
    setShowConfirm(false);
  }, [regions, onRestore, onClose, backup]);
  const handleConfirm = useCallback(() => {
    setShowConfirm(true);
  }, []);
  const handleCancel = useCallback(() => {
    setShowConfirm(false);
  }, []);

  return (
    <Dialog onClose={onClose} open={isOpen} className="dialog">
      <DialogTitle>Restore backup {backup}</DialogTitle>
      <List>
        <ListItem className="dialog__row">
          <Select value={dimension} onChange={handleSetDimension}>
            <MenuItem value="overworld">Overworld</MenuItem>
            <MenuItem value="nether">Nether</MenuItem>
            <MenuItem value="end">End</MenuItem>
          </Select>
          <Input
            className="dialog__input"
            placeholder="X"
            value={x}
            error={xError}
            onChange={handleSetX}
          />
          <Input
            className="dialog__input"
            placeholder="Z"
            value={z}
            error={zError}
            onChange={handleSetZ}
          />
          <IconButton title="Add" onClick={handleAddRegion}>
            <AddBox />
          </IconButton>
        </ListItem>
        {regions.length ? (
          regions.map((region, key) => (
            <RegionRow
              key={key}
              id={key}
              region={region}
              onRemove={handleRemoveRegion}
            />
          ))
        ) : (
          <ListItem button>
            <ListItemText primary="No specific regions selected. Restore all regions and player files" />
          </ListItem>
        )}
      </List>
      <Button
        className="dialog__button"
        type="submit"
        variant="contained"
        color="primary"
        onClick={handleConfirm}
      >
        Restore
      </Button>
      {showConfirm ? (
        <div className="dialog__confirm">
          <div className="dialog__text">
            Restore{" "}
            {regions.length
              ? regions.map(showRegion).join("; ")
              : "whole world (with player files etc.)"}
            {"?"}
          </div>
          <div className="dialog__buttons">
            <Button
              className="dialog__yes"
              type="submit"
              variant="contained"
              color="primary"
              onClick={handleRestore}
            >
              I'm sure
            </Button>
            <Button
              className="dialog__no"
              variant="contained"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
};

type RegionRowProps = {
  id: number;
  region: Region;
  onRemove: (id: number) => void;
};

const RegionRow: FC<RegionRowProps> = ({ id, region, onRemove }) => {
  const handleRemove = useCallback(() => {
    onRemove(id);
  }, [id, onRemove]);

  return (
    <ListItem button onClick={handleRemove}>
      <ListItemText primary={showRegion(region)} />
      <IconButton title="Remove">
        <RemoveCircleOutline />
      </IconButton>
    </ListItem>
  );
};

const useNumericInput = () => {
  const [x, setX] = useState("");
  const [xError, setXError] = useState(false);

  const checkXIsValid = useCallback((value: string) => {
    const isValid = value.match(/^-?[0-9]+$/);
    setXError(!isValid);
    return isValid;
  }, []);

  const handleSetX = useCallback<ChangeEventHandler<HTMLInputElement>>(
    event => {
      const newValue = event.target.value;
      setX(newValue);
      checkXIsValid(newValue);
    },
    [checkXIsValid]
  );

  return [x, xError, handleSetX, checkXIsValid] as const;
};
