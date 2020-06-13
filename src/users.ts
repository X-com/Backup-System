import fs from "fs";

const usersRaw: unknown = JSON.parse(
  fs.readFileSync("./config/users.json", "utf-8")
);

if (typeof usersRaw !== "object" || !Array.isArray(usersRaw)) {
  throw new Error("users.json should be array");
}

const users = usersRaw.map(userRaw => {
  if (!("login" in userRaw)) {
    throw new Error("no login for user");
  }
  if (!("password" in userRaw)) {
    throw new Error("no password for user");
  }
  const { login, password } = userRaw;
  if (typeof login !== "string") {
    throw new Error("login should be string");
  }
  if (typeof password !== "string") {
    throw new Error("password should be string");
  }
  return { login, password };
});

export const checkAuth = (login: string, password: string) => {
  const user = users.find(user => {
    return user.login === login && user.password === password;
  });
  return user ? login : undefined;
};
