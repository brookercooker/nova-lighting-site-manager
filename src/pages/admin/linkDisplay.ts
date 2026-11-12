/** Preview credentials belong only in the tab URL, never visible text or saved destinations. */
export function publicLinkAddress(value: string): string {
  return value.replace(/([?&])__lovable_token=[^&#\s]*/gi, "$1").replace(/\?&/g, "?").replace(/&&/g, "&").replace(/[?&](?=#|$)/g, "");
}
export function shortLinkLabel(value: string, max = 40): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
/** Display old saved summaries consistently without rewriting history. */
export function linkHistoryLine(value: string): string {
  const quoted = value.match(/^(.*?)changed (?:the (?:text|link|button) )?"([^"]*)" link to (.+)$/i);
  if (quoted) return `${quoted[1]}Changed link: ${shortLinkLabel(quoted[2])} to ${publicLinkAddress(quoted[3])}`;
  const repeated = value.match(/^(.*?)changed link(?: link)?:? (.*?) to (.+)$/i);
  return repeated ? `${repeated[1]}Changed link: ${shortLinkLabel(repeated[2])} to ${publicLinkAddress(repeated[3])}` : publicLinkAddress(value);
}