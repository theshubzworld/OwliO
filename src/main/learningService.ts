import { writingProvider } from '../shared/writingConfig';
import type { Store } from './store';
import { correctionCandidates } from './writingMemory';
import { classifyVocabulary } from './geminiFormatting';
import { text } from './validation';

export class LearningService {
  private busy = new Set<string>();
  constructor(private profile: Store) {}
  public async correct(historyId: string, edited: string) {
    const id = text(historyId,100), correction = text(edited,5000).trim();
    if (this.busy.has(id)) throw new Error('This correction is already being processed.');
    const item = this.profile.getHistory().find(item=>item.id===id);
    if (!item || item.deliveryStatus !== 'inserted' || item.isInstruct || item.isMeeting) throw new Error('Only an inserted dictation can teach vocabulary.');
    if (!correction) throw new Error('A correction cannot be empty.');
    if (correction === (item.editedText || item.formattedText)) return { added:0, pending:0 };
    this.busy.add(id);
    try {
      const settings = this.profile.getSettings();
      const candidates = settings.autoLearnCorrections ? correctionCandidates(item.editedText || item.formattedText, correction) : [];
      let accepted: string[] = [];
      if (candidates.length && writingProvider(settings) === 'gemini' && settings.geminiApiKey) {
        try { accepted = await classifyVocabulary(candidates,settings.geminiApiKey); }
        catch { /* Keep candidates visible for manual review when classification is unavailable. */ }
      }
      // A user may turn learning off while a classification request is running.
      const enabled = this.profile.getSettings().autoLearnCorrections;
      this.profile.saveCorrection(id,correction,enabled?candidates:[],enabled?accepted:[]);
      return { added:enabled?accepted.length:0, pending:enabled?candidates.length-accepted.length:0 };
    } finally { this.busy.delete(id); }
  }
}
