const isoDay = () => new Date().toISOString().slice(0, 10); // keep the count based on utc dates
export function dailyCount(state, date = isoDay()) { return Number(state.sentByDate?.[date] || 0); } // count successful sends for the selected day
export function canSend(state, limit, date = isoDay()) { return dailyCount(state, date) < limit; } // stop new sends once the daily cap is reached
