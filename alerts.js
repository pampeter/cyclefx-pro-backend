// Placeholder interface for future real-time alerts (push notification,
// email, SMS, or webhook) when getSignalStatus() flips to BUY_READY /
// SELL_READY, or when a setup becomes INVALID after being WAIT/valid.
//
// Intended usage once implemented:
//   const alerts = new AlertService({ channels: ['push', 'email'] });
//   alerts.notify(userId, { type: 'BUY_READY', pair, confidence });

export class AlertService {
  constructor(config) {
    this.config = config;
    // TODO: pick a delivery mechanism (web push, FCM, SES/SendGrid, etc.)
  }
  async notify(_userId, _payload) {
    throw new Error("AlertService.notify not implemented yet");
  }
  async subscribe(_userId, _channel) {
    throw new Error("AlertService.subscribe not implemented yet");
  }
}
