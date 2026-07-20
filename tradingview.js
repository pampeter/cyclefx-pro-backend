// Placeholder interface for a future TradingView chart embed / data feed.
// Not implemented yet — wire this up when the charting page is built.
//
// Intended usage once implemented:
//   const chart = new TradingViewAdapter({ symbol: 'EURUSD', interval: '30' });
//   chart.onCandleClose((candle) => strategyEngine.classifyStructure(...));

export class TradingViewAdapter {
  constructor(config) {
    this.config = config;
    // TODO: initialize TradingView widget / Charting Library instance
  }
  onCandleClose(_callback) {
    // TODO: subscribe to bar close events from the widget's datafeed
    throw new Error("TradingViewAdapter.onCandleClose not implemented yet");
  }
  drawZone(_zone) {
    // TODO: render the Level 2 decision zone as a shape on the chart
    throw new Error("TradingViewAdapter.drawZone not implemented yet");
  }
}
