#!/usr/bin/env bash
# tusg.site / tusg.co.jp の DNS とトップページの状態を取る（読み取りのみ）。
# 使い方: bash dns-check.sh > dns-raw-$(date +%Y%m%d).txt
q(){ curl -sS "https://dns.google/resolve?name=$1&type=$2" | python3 -c "import sys,json;d=json.load(sys.stdin);print('$1\t$2\t', [a['data'] for a in d.get('Answer',[])])"; }
for d in tusg.site tusg.co.jp; do for t in NS MX TXT A; do q $d $t; done; done
q _dmarc.tusg.site TXT; q _dmarc.tusg.co.jp TXT
q send.mail.tusg.site MX; q resend._domainkey.mail.tusg.site TXT
q resend._domainkey.fanmap.tusg.site TXT; q resend._domainkey.tusg.co.jp TXT
for h in www.tusg.site www.tusg.co.jp fanmap.tusg.site fanmap-crm.tusg.site fanmap-agency.tusg.site \
  clerk.fanmap.tusg.site status.fanmap.tusg.site cf-custom-hostname.fanmap.tusg.site \
  foodtap.tusg.site app-foodtap.tusg.site order-foodtap.tusg.site aim-rose.tusg.site \
  aburiya.tusg.site abemanager.tusg.site fansales.tusg.site lococreate.tusg.site fuloco.tusg.site; do q $h A; done
for u in https://tusg.co.jp/ https://www.tusg.co.jp/ https://tusg.site/ https://www.tusg.site/; do
  curl -sS -m 15 -o /tmp/_p.html -w "$u\t%{http_code}\t" "$u"; grep -oE 'rel="canonical" href="[^"]*"' /tmp/_p.html | head -1
done
