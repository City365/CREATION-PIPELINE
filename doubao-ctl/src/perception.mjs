// Perception: tag the actionable UI of the Doubao client and return a compact observation.
export const TAG_SCRIPT = [
  '(() => {',
  '  document.querySelectorAll("[data-db-ref]").forEach((e) => e.removeAttribute("data-db-ref"));',
  '  const out = [];',
  '  let n = 0;',
  '  const seen = new Set();',
  '  const clean = (s) => String(s || "").split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean)[0] || "";',
  '  const push = (el, region) => {',
  '    if (!el || !el.getClientRects().length) return;',
  '    const testid = el.getAttribute("data-testid") || "";',
  '    const label = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || clean(el.innerText) || testid || el.tagName.toLowerCase()).slice(0, 32);',
  '    const key = region + "|" + (testid || label);',
  '    if (seen.has(key)) return;',
  '    seen.add(key);',
  '    const ref = "e" + (++n);',
  '    el.setAttribute("data-db-ref", ref);',
  '    out.push({ ref, region, label, testid: testid || null, enabled: !(el.disabled === true || el.getAttribute("data-disabled") === "true") });',
  '  };',
  '  const composer = document.querySelector("[data-testid=chat_input]");',
  '  if (composer) {',
  '    [...composer.querySelectorAll("button")].forEach((b) => push(b, "composer"));',
  '    const ed = composer.querySelector("div.ProseMirror[contenteditable=true]");',
  '    if (ed) push(ed, "editor");',
  '  }',
  '  const side = document.querySelector("[data-testid=flow_chat_sidebar]");',
  '  if (side) {',
  '    [...side.querySelectorAll("[data-testid]")].filter((e) => !e.closest("[data-testid=chat_list_wrapper]")).forEach((e) => push(e, "sidebar"));',
  '    [...side.querySelectorAll("[data-testid=conversation-list-v2-item]")].slice(0, 8).forEach((e) => push(e, "conversation"));',
  '  }',
  '  [...document.querySelectorAll("[data-testid=chat_header_avatar_button], [data-testid=editable_conversation_name], [data-testid=chat_item_dropdown_entry]")].forEach((e) => push(e, "header"));',
  '  [...document.querySelectorAll("[role=menuitem], [role=menuitemcheckbox]")].filter((e) => e.getClientRects().length).forEach((e) => push(e, "menu"));',
  '  [...document.querySelectorAll("[role=dialog] button, [role=alertdialog] button")].forEach((e) => push(e, "dialog"));',
  '  if (out.length > 44) out.length = 44;',
  '  return out;',
  '})()',
].join(String.fromCharCode(10));

export const STATE_SCRIPT = [
  '(() => {',
  '  const lines = (el) => (el ? (el.innerText || "").split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean) : []);',
  '  const footBtn = document.querySelector("[data-sidebar-footer-account-menu] button");',
  '  const mens = lines(document.querySelector("[data-testid=chat_header_menu]"));',
  '  const convs = [...document.querySelectorAll("[data-testid=conversation-list-v2-item]")].slice(0, 6).map((el) => {',
  '    const leaf = [...el.querySelectorAll("span")].find((s) => s.children.length === 0 && (s.textContent || "").trim());',
  '    return { id: el.getAttribute("data-conversation-id") || "", title: leaf ? leaf.textContent.trim() : "" };',
  '  });',
  '  return {',
  '    url: location.href,',
  '    busy: !!document.querySelector("[data-testid=message_loading]"),',
  '    currentAccount: footBtn ? (lines(footBtn)[0] || "") : "",',
  '    menuOpen: !!document.querySelector("[data-testid=chat_header_menu]"),',
  '    menuAccounts: mens.filter((t) => t.length < 20).slice(0, 12),',
  '    conversations: convs,',
  '    model: lines(document.querySelector("[data-testid=chat_input_action_model]"))[0] || "",',
  '    mode: lines(document.querySelector("[data-testid=chat_input_action_mode]"))[0] || "",',
  '    dialogText: lines(document.querySelector("[role=dialog], [role=alertdialog]")).join(" / ").slice(0, 200),',
  '    toastText: lines(document.querySelector("[class*=toast], [class*=notification]")).join(" / ").slice(0, 160),',
  '  };',
  '})()',
].join(String.fromCharCode(10));

export const MESSAGES_SCRIPT = [
  '(() => {',
  '  const blocks = [...document.querySelectorAll("[data-testid=message-block-container]")].slice(-8);',
  '  return blocks.map((el) => {',
  '    const isUser = !!el.querySelector("[data-testid=send_message]");',
  '    const nodes = [...el.querySelectorAll("[data-testid=message_text_content]")];',
  '    const text = nodes.length ? nodes.map((n) => n.innerText || "").join(String.fromCharCode(10)) : (el.innerText || "");',
  '    return { role: isUser ? "user" : "assistant", text: String(text).slice(0, 600) };',
  '  }).filter((m) => m.text.trim());',
  '})()',
].join(String.fromCharCode(10));

export function summarize(observation) {
  const lines = [];
  lines.push('页面: ' + observation.url);
  lines.push('当前账号: ' + (observation.currentAccount || '未知') + ' | 模式: ' + (observation.mode || '?') + ' | 模型: ' + (observation.model || '?') + ' | 生成中: ' + (observation.busy ? '是' : '否'));
  if (observation.menuOpen) lines.push('账号菜单已展开: ' + observation.menuAccounts.join(' / '));
  if (observation.dialogText) lines.push('弹窗: ' + observation.dialogText);
  if (observation.toastText) lines.push('提示: ' + observation.toastText);
  if (observation.conversations.length) lines.push('会话: ' + observation.conversations.map((c) => c.title).join(' | '));
  return lines.join(String.fromCharCode(10));
}
