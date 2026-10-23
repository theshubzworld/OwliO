import type { AppSettings, LearnedWord, WritingPreference } from './store';
import type { WindowContext } from './aiService';

const canonicalApp = (app: string) => app.trim().toLowerCase().replace(/\.exe$/, '');
export function matchingPreferences(preferences: WritingPreference[], context: WindowContext, language: string): string[] {
  return preferences.filter(rule => rule.enabled && (rule.app === 'all' || canonicalApp(rule.app) === canonicalApp(context.processName)) && (rule.language === 'all' || rule.language === language)).map(rule => rule.text).slice(0,20);
}
export function preferredVocabulary(words: LearnedWord[]): {word:string;observedSource:string}[] {
  return words.filter(word => word.status === 'learned').sort((a,b) => b.count-a.count || b.lastUsed-a.lastUsed).slice(0,80).map(({word,observedSource})=>({word,observedSource}));
}
export function writingCategory(context: WindowContext): 'chat' | 'email' | 'code' | 'other' {
  const app = canonicalApp(context.processName);
  if (/^(code|cursor|windsurf|devenv|windowsterminal|powershell|pwsh|cmd)$/.test(app)) return 'code';
  if (/^(slack|discord|whatsapp|telegram|teams|ms-teams|signal)$/.test(app)) return 'chat';
  if (/^(outlook|thunderbird)$/.test(app)) return 'email';
  try {
    const host = new URL(context.browserUrl).hostname.toLowerCase();
    if (['chatgpt.com','web.whatsapp.com','discord.com','app.slack.com','teams.microsoft.com'].includes(host)) return 'chat';
    if (['mail.google.com','outlook.live.com','outlook.office.com'].includes(host)) return 'email';
  } catch { /* App-only context is valid. */ }
  return 'other';
}

export function adaptPunctuation(text: string, context: WindowContext, settings: Pick<AppSettings,'contextAwarePunctuation'|'punctuationMode'|'writingStyle'>, vocabulary: {word:string}[] = []): string {
  if (settings.contextAwarePunctuation === false || settings.writingStyle === 'code' || writingCategory(context) === 'code' || /\n|```|^[•*-]\s/.test(text)) return text;
  let result = text;
  const mode = settings.punctuationMode || 'auto';
  if (mode === 'minimal' || mode === 'auto' && settings.writingStyle !== 'professional' && (writingCategory(context) === 'chat' || settings.writingStyle === 'casual')) {
    if ((result.match(/[.!?]+(?=\s|$)/g) || []).length <= 2 && !/\b(?:Mr|Mrs|Ms|Dr|Prof|vs|etc)\.$/i.test(result)) result = result.replace(/\.$/, '');
  }
  // Never guess cursor position from the whole textbox. Apply only reliable captured ranges.
  if (context.beforeText === undefined || context.afterText === undefined || context.selectedText === undefined) return result;
  const before = context.beforeText, after = context.afterText;
  const firstWord = result.match(/^[\p{L}\p{M}]+/u)?.[0] || '';
  const proper = vocabulary.some(word => word.word.split(/\s/)[0] === firstWord) || /^[A-Z]{2,}$/.test(firstWord) || firstWord === 'I';
  if (/[\p{L}\p{N},]\s*$/u.test(before) && !proper) result = result.replace(/^\p{L}/u,letter=>letter.toLocaleLowerCase());
  if (/^[\p{L}\p{N},.;:!?]/u.test(after) && /[\p{L}\p{N},]\s*$/u.test(before)) result = result.replace(/\.+$/, '');
  if (/[\p{L}\p{N}]$/u.test(before) && /^[\p{L}\p{N}]/u.test(result)) result = ' ' + result;
  if (/^[\p{L}\p{N}]/u.test(after) && /[\p{L}\p{N}.!?]$/u.test(result)) result += ' ';
  return result;
}

const common = new Set(('a an the and or but to of for in on at is are was were be it this that these those i you he she we they my your our me us not no yes nahi haan hai hain tha thi ka ki ke ko se mein aur kal aaj parso first second third monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december one two three four five six seven eight nine ten eleven twelve send call meeting report please thanks thank actually morning evening tomorrow today yesterday').split(' '));
type Candidate = {word:string;observedSource:string};
export function correctionCandidates(original: string, edited: string): Candidate[] {
  if (original.length > 5000 || edited.length > 5000 || original === edited) return [];
  const tokens = (value:string) => value.match(/[\p{L}\p{M}][\p{L}\p{M}\p{N}_'-]*/gu) || [];
  const old = tokens(original), next = tokens(edited);
  if (!old.length || !next.length || old.length > 200 || next.length > 200 || Math.abs(old.length-next.length)>4) return [];
  const matrix = Array.from({length:old.length+1},()=>new Uint16Array(next.length+1));
  for (let i=old.length-1;i>=0;i--) for(let j=next.length-1;j>=0;j--) matrix[i][j]=old[i].toLocaleLowerCase()===next[j].toLocaleLowerCase()?matrix[i+1][j+1]+1:Math.max(matrix[i+1][j],matrix[i][j+1]);
  if (old.length > 4 && matrix[0][0] < old.length-4) return [];
  const candidates:Candidate[]=[]; let removed:string[]=[],added:string[]=[];
  const flush=()=>{
    if (removed.length && added.length && removed.length<=4 && added.length<=4) {
      const source=removed.join(' '),word=added.join(' ');
      if (source.length<=120 && word.length<=120 && word.length>=2 && !/[\d'_-]/.test(source+word) && !added.every(token=>common.has(token.toLocaleLowerCase())) && !removed.some(token=>common.has(token.toLocaleLowerCase()) && !added.some(target=>target.toLocaleLowerCase()===token.toLocaleLowerCase()))) candidates.push({word,observedSource:source});
    }
    removed=[];added=[];
  };
  let i=0,j=0;
  while(i<old.length || j<next.length){
    if(i<old.length && j<next.length && old[i].toLocaleLowerCase()===next[j].toLocaleLowerCase()){flush();i++;j++;}
    else if(i<old.length && (j===next.length || matrix[i+1][j]>=matrix[i][j+1]))removed.push(old[i++]);
    else added.push(next[j++]);
  }
  flush();
  return [...new Map(candidates.map(candidate=>[candidate.word.toLocaleLowerCase(),candidate])).values()].slice(0,4);
}
