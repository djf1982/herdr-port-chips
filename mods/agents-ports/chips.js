// Port chips: ":5173" links that open http://localhost:<port>. A listener that
// is not a web page (Postgres, Redis, a debugger) copies localhost:<port> instead.
// The same file is in spaces-ports and agents-ports: keep the copies alike.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, notify } from "herdr";

const MAX = 6;

function open(p) {
  if (p.http) {
    exec("open", [`http://localhost:${p.port}`]);
  } else {
    exec("sh", ["-c", `printf %s localhost:${p.port} | pbcopy`]);
    notify({ title: `Copied localhost:${p.port}`, body: p.name, timeout: 2000 });
  }
}

// `key` keeps element ids unique per row; `indent` lines chips up under the name.
export function portChips(t, key, ports, indent = 0) {
  if (!ports?.length) return null;
  const shown = ports.slice(0, MAX);
  const extra = ports.length - shown.length;
  const stop = (_e, cx) => cx.stop_propagation();
  return h_flex()
    .pl(indent)
    .pt(2)
    .gap(4)
    .flex_wrap()
    .items_center()
    .children(shown.map((p) => div()
      .id(`port-${key}-${p.port}`)
      .flex_none()
      .px(5)
      .h(17)
      .flex()
      .items_center()
      .rounded(4)
      .text_size(11)
      .bg(p.http ? t.accent + "1f" : t.raised)
      .text_color(p.http ? t.accent : t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(p.http ? t.accent + "38" : t.hover).underline())
      .tooltip(p.http ? `${p.name} · open http://localhost:${p.port}` : `${p.name} · copy localhost:${p.port}`)
      // The row underneath selects, drags or focuses on press and release.
      .on_mouse_down("left", stop)
      .on_mouse_up("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); open(p); })
      .child(`:${p.port}`)))
    .when(extra > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(`+${extra}`)));
}
