// Placeholder interface for a future AI-assisted analysis layer — e.g.
// having a model review a chart screenshot + the StrategyEngine output and
// produce a plain-language critique, or flag setups that look like the
// journal's historically losing patterns.
//
// Intended usage once implemented:
//   const ai = new AIAnalysisService({ provider: 'anthropic' });
//   const critique = await ai.reviewSetup({ structure, confidence, journalHistory });

export class AIAnalysisService {
  constructor(config) {
    this.config = config;
    // TODO: decide provider/model and whether this runs server-side only
    // (keep API keys off the client).
  }
  async reviewSetup(_context) {
    throw new Error("AIAnalysisService.reviewSetup not implemented yet");
  }
  async summarizeJournal(_entries) {
    throw new Error("AIAnalysisService.summarizeJournal not implemented yet");
  }
}
