let allowed = null;

export function setSessionGameRestriction(games) {
  if (Array.isArray(games) && games.length) {
    allowed = games.map((g) => String(g).trim().toLowerCase()).filter(Boolean);
  } else {
    allowed = null;
  }
}

export function clearSessionGameRestriction() {
  allowed = null;
}

export function getSessionGameRestriction() {
  return allowed ? [...allowed] : null;
}
