// 极简 i18n:跟随系统语言,中文默认,其余英文
export const ZH = navigator.language.toLowerCase().startsWith("zh");
export const t = (zh: string, en: string): string => (ZH ? zh : en);

// index.html 静态文案的英文替换(zh 为 HTML 默认)
export function applyStaticEn() {
  if (ZH) return;
  const set = (sel: string, text: string) => {
    const el = document.querySelector(sel);
    if (el) el.childNodes[0]!.textContent = text;
  };
  const setAll: [string, string][] = [
    ['#source-seg', ''], // placeholder
  ];
  void setAll;
  // 分区标签
  const secs = document.querySelectorAll(".sec-label");
  if (secs[0]) secs[0].textContent = "01 / SOURCE";
  if (secs[1]) secs[1].textContent = "02 / WHAT THE LEDS SHOW";
  const pro = document.querySelector(".pro .sec-label");
  if (pro) pro.textContent = "PRO MODE — FLASHES KEYBOARD FIRMWARE";
  // 模式按钮
  const modes = ["Quota", "Today", "Activity"];
  document.querySelectorAll<HTMLButtonElement>("#mode-seg button").forEach((b, i) => (b.textContent = modes[i] ?? b.textContent));
  // 设置区
  set(".settings summary", "SETTINGS");
  const labels = document.querySelectorAll(".settings > label");
  const lt = [
    "Claude daily budget (tokens)",
    "Codex daily budget (tokens)",
    "Weekly-limit warning threshold (%)",
    "Quota mode metric",
    "Claude activity color",
    "Codex activity color",
    "Swap red/green on this keyboard (GRB strip fix)",
    "Show usage on per-key backlight",
  ];
  labels.forEach((l, i) => {
    if (lt[i]) l.childNodes[0]!.textContent = lt[i] + " ";
  });
  const opts = document.querySelectorAll("#quota-metric option");
  const ot = ["5-hour first", "Weekly first", "Max of both"];
  opts.forEach((o, i) => (o.textContent = ot[i] ?? o.textContent));
  set("#save-config", "SAVE");
  // PRO 区
  const note = document.querySelector(".pro-note");
  if (note)
    note.innerHTML =
      'Heads-up: “Flash Pro firmware” <b>rewrites your keyboard\u2019s firmware</b> (not this app) with an open-source QMK build that adds usage lighting — unlocking the per-LED bar, keyboard-side switching, and offline self-healing. Keymap & macros are backed up and restored automatically; VIA keeps working.';
  set("#backup-keymap", "Back up keymap");
  set("#restore-stock", "Restore stock firmware");
  const ul = document.querySelector("#upgrade-label");
  if (ul) ul.textContent = "Flash Pro firmware";
  // 灯位面板
  const roleBtns = document.querySelectorAll<HTMLButtonElement>("#led-panel button[data-role]");
  const rt = ["Usage progress bar", "Source indicator", "Not involved (keep my lighting)"];
  // data-role 顺序: 1,2,0
  const order = ["1", "2", "0"];
  roleBtns.forEach((b) => {
    const i = order.indexOf(b.dataset.role ?? "");
    if (i >= 0) b.textContent = ["Usage progress bar", "Source indicator", "Not involved (keep my lighting)"][i];
  });
  void rt;
  set("#led-clear", "Clear selection");
  const styleRow = document.querySelector("#bar-style-row");
  if (styleRow) {
    styleRow.childNodes.forEach((n) => {
      if (n.nodeType === 3 && n.textContent?.includes("进度条样式")) n.textContent = " Bar style: ";
    });
    const sb = document.querySelectorAll<HTMLButtonElement>("#bar-style-row button");
    if (sb[0]) sb[0].textContent = "Count (lit LEDs = %)";
    if (sb[1]) sb[1].textContent = "Color (all lit, green→red)";
  }
}

// Rust 刷机进度消息的英文映射(精确匹配,未命中保留原文)
const PROGRESS: Record<string, string> = {
  "① 备份键位与宏…": "① Backing up keymap & macros…",
  "②/③ 进入 bootloader…": "②/③ Entering bootloader…",
  "尝试软件进入 bootloader…": "Trying software bootloader jump…",
  "固件不响应软件跳转,改用按键方案…": "Firmware ignores the soft jump — switching to key method…",
  "请在键盘上按 Fn+Esc 进入刷机模式(等待 120 秒)…": "Press Fn+Esc on the keyboard to enter flash mode (waiting 120 s)…",
  "④ 备份原厂固件…": "④ Reading out factory firmware…",
  "④ 刷入 Pro 固件…(约 10 秒,勿拔线)": "④ Flashing Pro firmware… (~10 s, do not unplug)",
  "⑤ 等待键盘重连…": "⑤ Waiting for the keyboard to reconnect…",
  "⑥ 写回键位备份…": "⑥ Restoring keymap backup…",
  "✅ 完成!已运行 Pro 固件,键位已恢复": "✅ Done! Pro firmware running, keymap restored",
  "② 刷入还原固件…": "② Flashing restore firmware…",
  "③ 等待键盘重连…": "③ Waiting for the keyboard to reconnect…",
  "④ 写回键位备份…": "④ Restoring keymap backup…",
  "✅ 已还原,键盘恢复为普通 VIA 键盘": "✅ Restored — the keyboard is a plain VIA keyboard again",
};
export function trProgress(msg: string): string {
  if (ZH) return msg;
  return PROGRESS[msg] ?? msg;
}
