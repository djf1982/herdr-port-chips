// Live TCP listeners on this computer, matched to Herdr terminals and spaces.
//
// A listener belongs to the nearest Herdr terminal among its parent processes
// (a dev server started in a pane, or by an agent's background shell). A
// listener with no terminal parent (nohup, a daemon) belongs to the space whose
// folder holds its working folder, when one does.
//
// Result, also shared as shared("ports") for other mods:
//   { at, byTerminal: { t3: [Port] }, bySpace: { <space id>: [Port] } }
//   Port = { port, name, http }

import { exec, terminals, spaces, panes, home } from "herdr";

// Listeners that are not web pages: a click copies host:port instead of opening.
const NOT_HTTP_NAMES = /^(postgres|redis|mysqld|mariadbd|mongod|memcached|beam|epmd|rabbitmq|nats|clickhouse|etcd)/i;
const NOT_HTTP_PORTS = new Set([5432, 6379, 3306, 27017, 11211, 9229, 9230, 5672, 4369, 2181, 9092]);

function parseListeners(out) {
  // lsof -F output: p<pid>, c<command>, f<fd>, n<address:port>.
  const byPid = new Map();
  let pid = null;
  let name = "";
  for (const line of out.split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") { pid = Number(val); name = ""; }
    else if (tag === "c") name = val;
    else if (tag === "n" && pid) {
      const port = Number(val.slice(val.lastIndexOf(":") + 1));
      if (!port) continue;
      const entry = byPid.get(pid) ?? { name, ports: new Set() };
      entry.ports.add(port);
      byPid.set(pid, entry);
    }
  }
  return byPid;
}

function parseParents(out) {
  const parent = new Map();
  for (const line of out.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid) parent.set(pid, ppid);
  }
  return parent;
}

function parseCwds(out) {
  const cwd = new Map();
  let pid = null;
  for (const line of out.split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid) cwd.set(pid, line.slice(1));
  }
  return cwd;
}

const portInfo = (port, name) => ({ port, name, http: !NOT_HTTP_PORTS.has(port) && !NOT_HTTP_NAMES.test(name) });

function add(map, key, info) {
  const list = (map[key] ??= []);
  if (!list.some((p) => p.port === info.port)) list.push(info);
}

// The folder each local space works in now, longest first, home left out
// (a space at ~ would claim every stray process).
function spaceFolders() {
  const ps = panes();
  const out = [];
  for (const s of spaces()) {
    if (s.machine) continue;
    const tabs = new Set(s.tabs.map((t) => t.id));
    for (const p of ps) {
      if (p.cwd && tabs.has(p.tab) && p.cwd !== home()) out.push({ space: s.id, dir: p.cwd.replace(/\/+$/, "") });
    }
  }
  return out.sort((a, b) => b.dir.length - a.dir.length);
}

export async function scan() {
  const result = { at: Date.now(), byTerminal: {}, bySpace: {} };
  const ls = await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], { timeout: 8000 });
  const listeners = parseListeners(ls.stdout ?? "");
  if (!listeners.size) return result;
  const ps = await exec("ps", ["-axo", "pid=,ppid="], { timeout: 8000 });
  const parent = parseParents(ps.stdout ?? "");

  // Local Herdr terminals by their process id.
  const termByPid = new Map();
  for (const t of terminals()) {
    if (t.state !== "live" || !t.pid || String(t.address).includes("/")) continue;
    termByPid.set(t.pid, t);
  }

  const orphans = [];
  for (const [pid, { name, ports }] of listeners) {
    let p = pid;
    let term = null;
    for (let hops = 0; p > 1 && hops < 64; hops++) {
      term = termByPid.get(p);
      if (term) break;
      p = parent.get(p);
    }
    if (!term) { orphans.push(pid); continue; }
    const space = term.labels?.["herdr.space"];
    for (const port of ports) {
      const info = portInfo(port, name);
      add(result.byTerminal, term.address, info);
      if (space) add(result.bySpace, space, info);
    }
  }

  // Strays: match their working folder to a space's folder.
  const folders = spaceFolders();
  if (orphans.length && folders.length) {
    const cw = await exec("lsof", ["-a", "-p", orphans.join(","), "-d", "cwd", "-Fpn"], { timeout: 8000 });
    const cwd = parseCwds(cw.stdout ?? "");
    for (const pid of orphans) {
      const dir = cwd.get(pid);
      if (!dir || dir === "/" || dir === home()) continue;
      const hit = folders.find((f) => dir === f.dir || dir.startsWith(f.dir + "/"));
      if (!hit) continue;
      const { name, ports } = listeners.get(pid);
      for (const port of ports) add(result.bySpace, hit.space, portInfo(port, name));
    }
  }

  for (const map of [result.byTerminal, result.bySpace]) {
    for (const list of Object.values(map)) list.sort((a, b) => a.port - b.port);
  }
  return result;
}

// Same content, ignoring when it was taken: avoids a shared write (and a
// redraw of every mod) when nothing changed.
export function same(a, b) {
  if (!a || !b) return false;
  return JSON.stringify([a.byTerminal, a.bySpace]) === JSON.stringify([b.byTerminal, b.bySpace]);
}
