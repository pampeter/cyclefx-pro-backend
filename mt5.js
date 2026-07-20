// Placeholder interface for a future live MT5 connection (separate from the
// standalone CycleFXPro.mq5 Expert Advisor, which already runs
// independently inside the terminal). This module is for a *server-side*
// bridge — e.g. via MT5's built-in HTTP/socket bridge or a broker API —
// so the web app could eventually read live prices/positions instead of
// manual candle entry.
//
// Intended usage once implemented:
//   const mt5 = new MT5Bridge({ host, port, accountId });
//   await mt5.connect();
//   const candles = await mt5.getCandles('EURUSD', 'M30', 20);

// STATUS UPDATE (v2.1): the candle-data half of this placeholder is now
// IMPLEMENTED — see backend/src/data/MT5CandleProvider.ts (reads) and
// backend/src/routes/mt5.js (POST /api/mt5/candles, what CycleFXPro.mq5's
// WebRequest push writes to). That path doesn't assume ZeroMQ, MetaApi, or
// any specific bridge — it's a plain HTTP push, so it works with the free
// EA-push approach today and could be fed by a cloud bridge later without
// changing MT5CandleProvider at all.
//
// STILL A PLACEHOLDER: order placement. Pushing price data to our backend
// and placing real orders through MT5 are different risk profiles — see
// backend/src/execution/BrokerConnector.ts for that interface, which
// remains intentionally unimplemented.
//
// This class (MT5Bridge) is kept only as a placeholder for a *bidirectional*
// bridge (e.g. ZeroMQ or MetaApi.cloud) that would eventually implement
// both a live data feed AND order execution through one connection. If you
// go that route later, prefer implementing BrokerConnector + a new
// MarketDataProvider directly rather than reviving this class — it predates
// the /strategy, /data, /execution module split and duplicates concerns
// that now live there.

export class MT5Bridge {
  constructor(config) {
    this.config = config;
    this.connected = false;
    // TODO: choose a bridge strategy — ZeroMQ EA bridge, MetaApi.cloud, or
    // a broker's REST API — and implement the transport here.
  }
  async connect() {
    throw new Error("MT5Bridge.connect not implemented yet");
  }
  async getCandles(_symbol, _timeframe, _count) {
    throw new Error("MT5Bridge.getCandles not implemented yet — see MT5CandleProvider.ts for the working alternative.");
  }
  async placeOrder(_orderSpec) {
    throw new Error("MT5Bridge.placeOrder not implemented yet");
  }
}
