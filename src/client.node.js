import ws from "ws";
import client from "./client";

export default function clientFactory(...args) {
  if (args.length === 1) {
    return client(ws, args[0]);
  }
  if (args.length === 2) {
    return client(ws, args[0], args[1]);
  }
  return client(ws, args[0], args[1], args[2]);
}
