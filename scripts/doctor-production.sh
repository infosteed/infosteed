#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=production-compose.sh
source "$script_dir/production-compose.sh"

deep=false
case ${1:-} in
  "") ;;
  --deep) deep=true ;;
  -h|--help) echo "Usage: scripts/doctor-production.sh [--deep]"; exit 0 ;;
  *) echo "Usage: scripts/doctor-production.sh [--deep]" >&2; exit 2 ;;
esac

failures=0
pass() { printf '[ok] %s\n' "$*"; }
fail() { printf '[failed] %s\n' "$*" >&2; failures=$((failures + 1)); }
note() { printf '[info] %s\n' "$*"; }

if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  pass "Docker Compose v2 is available"
else
  fail "Docker Compose v2 is unavailable"
fi

if ! production_load_compose; then
  fail "production configuration could not be loaded"
  exit 1
fi
pass "production environment is private and modes are valid"
if "${production_compose[@]}" config --quiet; then pass "Compose configuration is valid"; else fail "Compose configuration is invalid"; fi

note "Configured modes: TLS=$TLS_MODE LLM=$LLM_MODE transcription=$TRANSCRIPTION_MODE voiceover=$VOICEOVER_MODE"
"${production_compose[@]}" ps -a || fail "container state could not be read"

if getent ahosts "$APP_DOMAIN" >/dev/null 2>&1; then pass "$APP_DOMAIN resolves on this host"; else fail "$APP_DOMAIN does not resolve on this host"; fi
tls_args=()
if [[ $TLS_MODE == internal && -f $production_root/deploy/infosteed-local-ca.crt ]]; then
  tls_args=(--cacert "$production_root/deploy/infosteed-local-ca.crt")
fi
if curl -fsSI --max-time 10 "${tls_args[@]}" "https://$APP_DOMAIN" >/dev/null 2>&1; then
  pass "HTTPS responds at https://$APP_DOMAIN"
else
  fail "HTTPS did not respond at https://$APP_DOMAIN"
fi
if [[ $TLS_MODE == internal && -f $production_root/deploy/infosteed-local-ca.crt ]]; then
  pass "internal CA certificate has been exported"
  openssl x509 -in "$production_root/deploy/infosteed-local-ca.crt" -noout -fingerprint -sha256 || fail "exported CA certificate is invalid"
fi

provider_check='const clean=(u)=>u.replace(/\/$/,"");
async function request(name,url,options={}) { if (!url) return; try { const r=await fetch(url,options); if (!r.ok) throw new Error(`HTTP ${r.status}`); await r.arrayBuffer(); console.log(`[ok] ${name}`); } catch(e) { console.error(`[failed] ${name}: ${e.message}`); process.exitCode=1; } }
const deep=process.argv[1]==="deep";
const ai=process.env.AI_ENDPOINT||"", tr=process.env.TRANSCRIPTION_ENDPOINT||"", tts=process.env.TTS_BASE_URL||"";
if (ai) {
 const headers=process.env.AI_API_KEY?{Authorization:`Bearer ${process.env.AI_API_KEY}`}:{ };
 if (deep) await request("LLM request", clean(ai)+(process.env.AI_PROVIDER==="ollama"?"/api/chat":"/chat/completions"), {method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(process.env.AI_PROVIDER==="ollama"?{model:process.env.AI_MODEL,messages:[{role:"user",content:"Reply OK"}],stream:false}:{model:process.env.AI_MODEL,messages:[{role:"user",content:"Reply OK"}],max_tokens:4})});
 else await request("LLM endpoint", process.env.AI_PROVIDER==="ollama"?clean(ai)+"/api/tags":clean(ai)+"/models", {headers});
}
if (tr) {
 const base=clean(tr).replace(/\/v1$/,""); await request("transcription health",base+"/health");
 if (deep) { const rate=8000,n=800,w=Buffer.alloc(44+n*2); w.write("RIFF",0);w.writeUInt32LE(36+n*2,4);w.write("WAVEfmt ",8);w.writeUInt32LE(16,16);w.writeUInt16LE(1,20);w.writeUInt16LE(1,22);w.writeUInt32LE(rate,24);w.writeUInt32LE(rate*2,28);w.writeUInt16LE(2,32);w.writeUInt16LE(16,34);w.write("data",36);w.writeUInt32LE(n*2,40); const f=new FormData();f.append("file",new Blob([w],{type:"audio/wav"}),"check.wav");f.append("model",process.env.TRANSCRIPTION_MODEL);f.append("response_format","verbose_json"); await request("authenticated transcription",clean(tr)+"/audio/transcriptions",{method:"POST",headers:process.env.TRANSCRIPTION_API_KEY?{Authorization:`Bearer ${process.env.TRANSCRIPTION_API_KEY}`}:{},body:f}); }
}
if (tts) { const base=clean(tts).replace(/\/v1$/,""); await request("voiceover health",base+"/health"); if(deep) await request("voiceover request",clean(tts)+"/audio/speech",{method:"POST",headers:{...(process.env.TTS_API_KEY?{Authorization:`Bearer ${process.env.TTS_API_KEY}`}:{ }),"content-type":"application/json"},body:JSON.stringify({model:process.env.TTS_MODEL,input:"InfoSteed check",voice:process.env.TTS_DEFAULT_VOICE,response_format:"wav"})}); }
'
if "${production_compose[@]}" exec -T api node --input-type=module -e "$provider_check" "$([[ $deep == true ]] && printf deep || printf shallow)"; then
  pass "configured provider checks completed"
else
  fail "one or more configured providers are unreachable from the API container"
fi

if ((failures)); then
  printf '%d production diagnostic check(s) failed.\n' "$failures" >&2
  exit 1
fi
pass "production diagnostics completed"
