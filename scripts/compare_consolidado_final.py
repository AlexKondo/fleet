#!/usr/bin/env python3
"""Read-only three-way comparison with CRLF/LF equivalence. Never copies or executes project files."""
import argparse,hashlib,json
from pathlib import Path
from compare_kondo_source import classify

def raw(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
def normalized(p):
 if not p.is_file():return None
 data=p.read_bytes()
 try:
  if b'\0' not in data:data.decode('utf-8');data=data.replace(b'\r\n',b'\n')
 except UnicodeDecodeError:pass
 return hashlib.sha256(data).hexdigest()
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('current',type=Path);parser.add_argument('--incoming',type=Path,default=Path(__file__).resolve().parents[1]);args=parser.parse_args();root=args.incoming.resolve();current=args.current.resolve()
 if not (current/'package.json').is_file():parser.error('Current must be a FleetMind checkout. Nothing changed.')
 base=json.loads((root/'docs/consolidado_final/BASELINE_C6_NORMALIZED_SHA256.json').read_text());manifest=json.loads((root/'docs/consolidado_final/INCOMING_SOURCE_SHA256.json').read_text());rows=[]
 for name,digest in sorted(manifest.items()):
  relative=Path(name)
  if relative.is_absolute() or '..' in relative.parts:raise ValueError('Unsafe manifest path')
  source=(root/relative).resolve();target=(current/relative).resolve()
  if not source.is_relative_to(root) or not target.is_relative_to(current):raise ValueError('Path outside checkout')
  if raw(source)!=digest:raise ValueError('Incoming hash mismatch: '+name)
  result=classify(base.get(name),normalized(source),normalized(target))
  if result!='already_equal':rows.append({'path':name,'result':result})
 print(json.dumps({'mode':'read_only','baseline':'c6b26da ZIP','normalizes':'CRLF/LF for UTF-8 text only','counts':{k:sum(r['result']==k for r in rows) for k in ['candidate_change','keep_kondo','needs_merge']},'files':rows},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
