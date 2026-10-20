export function cookieChoice(state, action) {
  if (action !== "accept" && action !== "decline") throw new Error(`Unknown action ${action}`);
  return { ...state, consent: action === "accept", visible: false };
}
