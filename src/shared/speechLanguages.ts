// Language codes from OpenAI Whisper tokenizer. Keep original-script transcription.
// Source: https://github.com/openai/whisper/blob/main/whisper/tokenizer.py
export const WHISPER_LANGUAGES = [
  {code:"af",name:"Afrikaans"},
  {code:"sq",name:"Albanian"},
  {code:"am",name:"Amharic"},
  {code:"ar",name:"Arabic"},
  {code:"hy",name:"Armenian"},
  {code:"as",name:"Assamese"},
  {code:"az",name:"Azerbaijani"},
  {code:"ba",name:"Bashkir"},
  {code:"eu",name:"Basque"},
  {code:"be",name:"Belarusian"},
  {code:"bn",name:"Bengali"},
  {code:"bs",name:"Bosnian"},
  {code:"br",name:"Breton"},
  {code:"bg",name:"Bulgarian"},
  {code:"my",name:"Burmese (Myanmar)"},
  {code:"yue",name:"Cantonese"},
  {code:"ca",name:"Catalan"},
  {code:"zh",name:"Chinese"},
  {code:"hr",name:"Croatian"},
  {code:"cs",name:"Czech"},
  {code:"da",name:"Danish"},
  {code:"nl",name:"Dutch"},
  {code:"en",name:"English"},
  {code:"et",name:"Estonian"},
  {code:"fo",name:"Faroese"},
  {code:"fi",name:"Finnish"},
  {code:"fr",name:"French"},
  {code:"gl",name:"Galician"},
  {code:"ka",name:"Georgian"},
  {code:"de",name:"German"},
  {code:"el",name:"Greek"},
  {code:"gu",name:"Gujarati"},
  {code:"ht",name:"Haitian Creole"},
  {code:"ha",name:"Hausa"},
  {code:"haw",name:"Hawaiian"},
  {code:"he",name:"Hebrew"},
  {code:"hi",name:"Hindi"},
  {code:"hu",name:"Hungarian"},
  {code:"is",name:"Icelandic"},
  {code:"id",name:"Indonesian"},
  {code:"it",name:"Italian"},
  {code:"ja",name:"Japanese"},
  {code:"jw",name:"Javanese"},
  {code:"kn",name:"Kannada"},
  {code:"kk",name:"Kazakh"},
  {code:"km",name:"Khmer"},
  {code:"ko",name:"Korean"},
  {code:"lo",name:"Lao"},
  {code:"la",name:"Latin"},
  {code:"lv",name:"Latvian"},
  {code:"ln",name:"Lingala"},
  {code:"lt",name:"Lithuanian"},
  {code:"lb",name:"Luxembourgish"},
  {code:"mk",name:"Macedonian"},
  {code:"mg",name:"Malagasy"},
  {code:"ms",name:"Malay"},
  {code:"ml",name:"Malayalam"},
  {code:"mt",name:"Maltese"},
  {code:"mi",name:"Maori"},
  {code:"mr",name:"Marathi"},
  {code:"mn",name:"Mongolian"},
  {code:"ne",name:"Nepali"},
  {code:"no",name:"Norwegian"},
  {code:"nn",name:"Norwegian Nynorsk"},
  {code:"oc",name:"Occitan"},
  {code:"ps",name:"Pashto"},
  {code:"fa",name:"Persian"},
  {code:"pl",name:"Polish"},
  {code:"pt",name:"Portuguese"},
  {code:"pa",name:"Punjabi"},
  {code:"ro",name:"Romanian"},
  {code:"ru",name:"Russian"},
  {code:"sa",name:"Sanskrit"},
  {code:"sr",name:"Serbian"},
  {code:"sn",name:"Shona"},
  {code:"sd",name:"Sindhi"},
  {code:"si",name:"Sinhala"},
  {code:"sk",name:"Slovak"},
  {code:"sl",name:"Slovenian"},
  {code:"so",name:"Somali"},
  {code:"es",name:"Spanish"},
  {code:"su",name:"Sundanese"},
  {code:"sw",name:"Swahili"},
  {code:"sv",name:"Swedish"},
  {code:"tl",name:"Tagalog"},
  {code:"tg",name:"Tajik"},
  {code:"ta",name:"Tamil"},
  {code:"tt",name:"Tatar"},
  {code:"te",name:"Telugu"},
  {code:"th",name:"Thai"},
  {code:"bo",name:"Tibetan"},
  {code:"tr",name:"Turkish"},
  {code:"tk",name:"Turkmen"},
  {code:"uk",name:"Ukrainian"},
  {code:"ur",name:"Urdu"},
  {code:"uz",name:"Uzbek"},
  {code:"vi",name:"Vietnamese"},
  {code:"cy",name:"Welsh"},
  {code:"yi",name:"Yiddish"},
  {code:"yo",name:"Yoruba"},
 ] as const;
// Flex model card and the bundled pinned loader both enumerate these 27 codes.
// https://huggingface.co/bodhan-ai/indic-transcribe-flex#supported-language-codes
export const FLEX_LANGUAGE_CODES = ['as','bgc','bhb','bho','bn','brx','doi','en','gu','hi','hne','kn','kok','ks','mai','ml','mni','mr','ne','or','pa','sa','sat','sd','ta','te','ur'];
const FLEX_EXTRA_LANGUAGES = [
  {code:'bgc',name:'Haryanvi'},{code:'bhb',name:'Bhili'},{code:'bho',name:'Bhojpuri'},
  {code:'brx',name:'Bodo'},{code:'doi',name:'Dogri'},{code:'hne',name:'Chhattisgarhi'},
  {code:'kok',name:'Konkani'},{code:'ks',name:'Kashmiri'},{code:'mai',name:'Maithili'},
  {code:'mni',name:'Manipuri'},{code:'or',name:'Odia'},{code:'sat',name:'Santali'},
];
export const SPEECH_LANGUAGES = [{code:'auto',name:'Detect automatically'}, {code:'hinglish',name:'Hindi + English (Hinglish)'}, ...[...WHISPER_LANGUAGES,...FLEX_EXTRA_LANGUAGES].sort((a,b)=>a.name.localeCompare(b.name))];
export const SPEECH_LANGUAGE_CODES = SPEECH_LANGUAGES.map(item=>item.code);
export function languageName(code:string):string {return SPEECH_LANGUAGES.find(item=>item.code===code)?.name || code;}
export function documentedModelLanguages(model:string):string[]|null {
  const id=model.replace(/^hf:/,'').toLowerCase();
  if(id==='bodhan-flex'||id==='bodhan-ai/indic-transcribe-flex')return [...FLEX_LANGUAGE_CODES];
  // Fine-tuning retains tokenizer tokens, but that does not establish trained coverage.
  // https://huggingface.co/Trelis/whisper-hinglish-preview
  if(['trelis/whisper-hinglish-preview','mayank-dubey-ai/whisper-large-v3-turbo-hinglish','oriserve/whisper-hindi2hinglish-apex'].includes(id))return ['hi','en'];
  if(/^(?:openai\/whisper-|systran\/faster-whisper-)(?:tiny|base|small|medium)\.en$/.test(id))return ['en'];
  const standard=id.replace(/^(?:openai\/whisper-|systran\/faster-whisper-)/,'');
  if(['tiny','base','small','medium','large-v2'].includes(standard))return WHISPER_LANGUAGES.filter(item=>item.code!=='yue').map(item=>item.code);
  if(['large-v3','turbo','large-v3-turbo'].includes(standard))return WHISPER_LANGUAGES.map(item=>item.code);
  return null;
}
export function providerSupportsLanguage(provider:string,language:string):boolean {
  if(!['local','groq'].includes(provider)||!SPEECH_LANGUAGE_CODES.includes(language))return false;
  if(provider==='local')return true;
  return language==='auto'||language==='hinglish'||WHISPER_LANGUAGES.some(item=>item.code===language&&(language!=='yue'||provider==='groq'));
}
export function supportsSpeechLanguage(provider:string,model:string,language:string):boolean {
  if(!providerSupportsLanguage(provider,language))return false;
  if(provider!=='local')return true;
  const codes=documentedModelLanguages(model);
  if(!codes)return true; // Manual custom models are checked by their backend; never guessed for automatic selection.
  if(language==='auto')return true;
  return codes.includes(language==='hinglish'?'hi':language);
}
export type LanguageModel = {id:string;name?:string;downloaded?:boolean;languages?:string[]|null};
export function modelHasDocumentedLanguage(model:LanguageModel,language:string):boolean {
  const codes=documentedModelLanguages(model.id)||model.languages;
  if(!codes?.length)return false;
  if(language==='auto')return codes.length>=99; // Unknown spoken language needs broad detection rather than an Indic-only model.
  return language==='hinglish'?codes.includes('hi')&&codes.includes('en'):codes.includes(language);
}
export function selectSpeechModel(language:string,current:string,models:LanguageModel[]=[]):{model:string;downloaded:boolean;changed:boolean} {
  const existing=models.find(item=>item.id===current)||{id:current};
  const compatibleCurrent=modelHasDocumentedLanguage(existing,language);
  if(compatibleCurrent&&existing.downloaded)return {model:current,downloaded:true,changed:false};
  const order=language==='hi'||language==='hinglish'
    ?['hf:mayank-dubey-ai/whisper-large-v3-turbo-hinglish','hf:Oriserve/Whisper-Hindi2Hinglish-Apex','hf:Trelis/whisper-hinglish-preview','bodhan-flex','small','base','turbo','tiny','medium','large-v3']
    :['small','base','turbo','tiny','medium','large-v3','bodhan-flex'];
  const rank=(id:string)=>{const index=order.findIndex(candidate=>candidate.toLowerCase()===id.toLowerCase());return index<0?(language==='hinglish'&&id.startsWith('hf:')?2.5:order.length):index;};
  const installed=models.filter(item=>item.downloaded&&modelHasDocumentedLanguage(item,language)).sort((a,b)=>rank(a.id)-rank(b.id)||a.id.localeCompare(b.id));
  if(installed.length)return {model:installed[0].id,downloaded:true,changed:installed[0].id!==current};
  if(compatibleCurrent)return {model:current,downloaded:false,changed:false};
  const preferred=language==='yue'?'turbo':WHISPER_LANGUAGES.some(item=>item.code===language)||['auto','hinglish'].includes(language)?'small':'bodhan-flex';
  return {model:preferred,downloaded:!!models.find(item=>item.id===preferred)?.downloaded,changed:preferred!==current};
}
export function modelLanguageSummary(model:string,declared?:string[]|null):string {
  const codes=documentedModelLanguages(model)||declared;
  if(!codes?.length)return 'Language coverage is unverified. Custom models require manual checking.';
  if(codes.length>=99)return `${codes.length} languages · multilingual Whisper`;
  if(model==='bodhan-flex')return '27 languages · Indian languages and English';
  return codes.map(languageName).join(', ');
}
export function usesHindiConversion(language:string):boolean {return language==='hi'||language==='hinglish';}
export function usesLatinScript(text:string):boolean {return !/(?!\p{Script=Latin})\p{L}/u.test(text);}
