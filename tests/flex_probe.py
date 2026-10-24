"""Isolated, offline Bodhan Flex Romanized-Hinglish benchmark.

Requires the pinned model and its reviewed loader in models/bodhan-ai/indic-transcribe-flex.
Does not change Owlio settings or send recordings to a remote service.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def run():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
    parser.add_argument('--audio', default=str(ROOT/'tests/.runtime/hinglish-test.wav'))
    parser.add_argument('--modes', nargs='+', choices=['native'], default=['native'])
    parser.add_argument('--threads', type=int, default=6)
    args = parser.parse_args()
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    if args.device == 'cpu':
        os.environ['CUDA_VISIBLE_DEVICES'] = ''
    import psutil
    import soundfile as sf
    import torch
    torch.set_num_threads(args.threads)
    model_dir = ROOT/'models/bodhan-ai/indic-transcribe-flex'
    if not (model_dir/'model.safetensors').is_file():
        raise RuntimeError('Flex weights have not been downloaded.')
    sys.path.insert(0, str(model_dir))
    from indic_transcribe import IndicTranscribe
    process = psutil.Process()
    stopped = threading.Event()
    memory = {'peak_rss': process.memory_info().rss}
    def monitor():
        while not stopped.wait(0.02):
            memory['peak_rss'] = max(memory['peak_rss'], process.memory_info().rss)
    worker = threading.Thread(target=monitor, daemon=True)
    worker.start()
    try:
        if args.device == 'cuda':
            torch.cuda.reset_peak_memory_stats()
        start = time.perf_counter()
        print(f'Loading full Flex checkpoint on {args.device}…', flush=True)
        asr = IndicTranscribe.from_pretrained(str(model_dir), device=args.device,
                                            dtype=torch.bfloat16 if args.device == 'cuda' else torch.float32)
        load_seconds = time.perf_counter()-start
        duration = sf.info(args.audio).duration
        print(f'Loaded in {load_seconds:.2f}s. Audio: {duration:.2f}s.', flush=True)
        results = []
        for mode in args.modes:
            print('Testing mode:',mode,flush=True)
            if args.device == 'cuda':
                torch.cuda.synchronize()
            started = time.perf_counter()
            text = asr(args.audio, lang='hi', mode=mode, max_new_tokens=500)
            if args.device == 'cuda':
                torch.cuda.synchronize()
            elapsed = time.perf_counter()-started
            row = {'mode':mode, 'language':'hi', 'text':text,
                   'inference_seconds':round(elapsed,3), 'audio_seconds':round(duration,3),
                   'speed_times_realtime':round(duration/elapsed,3),
                   'contains_devanagari':bool(re.search(r'[\u0900-\u097f]',text)),
                   'english_phrases':{phrase:phrase in text.lower() for phrase in
                                     ['you are high on your own supply','power','propaganda','believe','because']}}
            results.append(row)
            print(json.dumps(row,ensure_ascii=False),flush=True)
        report = {'repository':'bodhan-ai/indic-transcribe-flex',
                  'revision':'ecba9bac9013c0340fe814b336897ee51ed80be9',
                  'device':args.device,'dtype':str(next(asr.model.parameters()).dtype),
                  'cpu_threads':args.threads,'model_load_seconds':round(load_seconds,3),
                  'peak_process_rss_gb':round(memory['peak_rss']/1e9,3),
                  'peak_cuda_allocated_gb':round(torch.cuda.max_memory_allocated()/1e9,3) if args.device=='cuda' else None,
                  'results':results,'app_settings_changed':False,
                  'scope':'One public conversational Hinglish recording; not a broad accuracy benchmark.'}
        output = ROOT/'tests/.runtime'/f'flex-{args.device}-results.json'
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print('Report:',output,flush=True)
    finally:
        stopped.set()
        worker.join(timeout=1)


if __name__=='__main__':
    run()
