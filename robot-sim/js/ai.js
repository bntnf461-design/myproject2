/* =====================================================================
 * ai.js — 日本語の指示からロボットプログラムを作る（Claude）
 *
 * 2つの使い方
 *   1) API キーを入れて「AIで作成」：このページから Claude API を直接呼びます。
 *   2) API キーなし：「指示文をコピー」→ claude.ai などに貼り付け →
 *      返ってきた回答（JSON）を貼り付けて「回答を取り込む」。
 *
 * 外部ライブラリを使わずに単一フォルダ・オフラインで動かすため、SDK ではなく fetch で呼んでいます。
 * ===================================================================== */
(function (RS) {
  'use strict';

  RS.AI_MODEL = 'claude-opus-5-5';

  const POS_SCHEMA = {
    type: 'object',
    properties: {
      id: { type: 'string', description: '位置名。安川は C00000 形式、ファナックは P[1] 形式' },
      kind: { type: 'string', enum: ['cart', 'joint'] },
      values: { type: 'array', items: { type: 'number' }, description: 'cart: [X,Y,Z(mm), Rx/W,Ry/P,Rz/R(度)]、joint: 6軸の角度(度)' },
      uf: { type: 'integer', description: 'ユーザ座標番号。通常 0' }
    },
    required: ['id', 'kind', 'values', 'uf'],
    additionalProperties: false
  };
  RS.AI_SCHEMA = {
    type: 'object',
    properties: {
      explanation: { type: 'string', description: '何をどう作った・変えたかの日本語の説明（箇条書き可）' },
      warnings: { type: 'array', items: { type: 'string' }, description: '実機で確認すべき点・前提にした仮定' },
      programs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'プログラム名（英大文字・数字・_ のみ）' },
            comment: { type: 'string' },
            lines: { type: 'array', items: { type: 'string' }, description: '命令文（1要素=1行。行番号・NOP・END の外枠・末尾の ; は書かない）' },
            positions: { type: 'array', items: POS_SCHEMA }
          },
          required: ['name', 'comment', 'lines', 'positions'],
          additionalProperties: false
        }
      }
    },
    required: ['explanation', 'warnings', 'programs'],
    additionalProperties: false
  };

  const LANG = {
    yaskawa: `安川電機 INFORM（YRC1000 / DX200 のジョブ）。使える命令：
- MOVJ Cxxxxx VJ=速度%（1.00〜100.00） [PL=0〜8]
- MOVL Cxxxxx V=速度mm/s [PL=0〜8]
- IMOV Pxxx V=mm/s [BF|TF]（位置変数分だけ相対移動）
- DOUT OT#(n) ON|OFF、PULSE OT#(n) T=秒
- WAIT IN#(n)=ON|OFF [T=秒]
- TIMER T=秒
- *ラベル、JUMP *ラベル [IF IN#(n)=ON / IF I000<5 など]
- CALL JOB:名前 [IF 条件]、RET、PAUSE
- SET/ADD/SUB/MUL/DIV Ixxx 値、INC Ixxx、DEC Ixxx（変数 B/I/D/R 000〜099）
- SFTON Pxxx [BF|TF]、SFTOF（位置変数でシフト）
- 'コメント
位置名は C00000 から。NOP と END は書かない（自動で付く）。`,
    fanuc: `ファナック TP 言語（R-30iB の .LS）。使える命令：
- J P[n] 速度% FINE|CNTn [Offset,PR[m] | Tool_Offset,PR[m]]
- L P[n] 速度mm/sec FINE|CNTn [Offset,PR[m] | Tool_Offset,PR[m]]
- J/L PR[n] ...（位置レジスタへ移動）
- DO[n]=ON|OFF、RO[n]=ON|OFF|PULSE,秒sec
- WAIT DI[n]=ON|OFF [TIMEOUT,LBL[m]]、WAIT RI[n]=ON、WAIT 秒(sec)
- LBL[n]、JMP LBL[n]、IF R[n]<値,JMP LBL[m]、IF DI[n]=ON,JMP LBL[m]、IF DI[n]=ON AND R[m]<3,JMP LBL[k]（AND と OR は混ぜない）
- CALL 名前、END、PAUSE、ABORT
- R[n]=式（+ - * / と R[m]、数値）
- PR[n]=LPOS、PR[n]=JPOS、PR[n]=PR[m]、PR[n]=PR[a]-PR[b]、PR[n,i]=式（i=1〜6: X,Y,Z,W,P,R）
- UFRAME_NUM=n、UTOOL_NUM=n、OVERRIDE=n%、!コメント
位置名は P[1] から。行番号・末尾の ; は書かない。`
  };

  /* 指示文（システムプロンプト）を作る
   * c = { sys, robot, tool, work, tables, io, prog, lib, uframes } */
  RS.aiSystemPrompt = function (c) {
    const d = c.robot.dims;
    const reach = Math.round((d.pivR + d.la + Math.hypot(d.ua, d.a3 || 0) + d.fl) * 1000);
    const tbl = c.tables.map(t => `- ${t.name}（${t.id}）：中心 X=${t.X * 1000} Y=${t.Y * 1000} mm、上面の高さ Z=${t.h * 1000} mm、大きさ ${t.w * 1000}×${t.d * 1000} mm`).join('\n');
    const toolCups = c.tool.kind === 'vacuum' ? `吸盤 ${c.tool.cups.length} 個（ツール座標 XY：${c.tool.cups.map(p => `(${p[0] * 1000},${p[1] * 1000})`).join(' ')} mm）。すべての吸盤がワーク上面に接したとき（すき間±4mm）だけ吸着する。` : `2爪グリッパ（開き ${c.tool.grip.open * 1000}mm、爪はツール Y 方向に開閉）。TCP がワークの中に入っている状態で閉じるとつかむ。`;
    return `あなたは産業用ロボットのティーチング（教示）担当エンジニアです。社内の教育・プログラム検証用シミュレーターで、ユーザーの日本語の指示から ${c.robot.label} のロボットプログラムを作成・修正します。作ったプログラムは実機でも使われることがあるため、安全で、実機でそのまま読み込める正しい文法で書いてください。

# 言語
${LANG[c.sys]}
この一覧にない命令・オプション（INC、Skip、UNTIL、TOOL#、Wjnt など）は使わない。シミュレーターで確認できず実機で動きが変わるため。必要だと思う場合は warnings に「提案」として書くだけにする。

# 座標系
- ロボット座標：原点はロボットの旋回中心の床面。X が前方、Y が左、Z が上（mm）。
- 姿勢は ${c.robot.cart.slice(3).join('/')}（度）。R = Rz·Ry·Rx の固定角。ツールを真下に向け、ツール X をロボット X に合わせた姿勢が (180, 0, 0)。
- 直交位置の values は [X, Y, Z, ${c.robot.cart.slice(3).join(', ')}]、関節位置は [${c.robot.axes.join(', ')}]（度）。新しく作る位置は必ず cart（直交）で書く（関節値はこのシミュレーターの向きの決まりに依存するため、既存の位置を残す場合を除いて使わない）。
- ${c.sys === 'fanuc' ? 'J3 は水平からの角度（J2/J3 連動）。' : ''}

# ロボット
- 機種：${c.robot.model}（最大リーチ 約 ${reach} mm、フランジまで）
- 可動範囲（度）：${c.robot.axes.map((a, i) => `${a} ${c.robot.lim[i][0]}〜${c.robot.lim[i][1]}`).join('、')}
- 待機位置（関節）：[${c.robot.home.join(', ')}]

# ハンド（ツール）
- ${c.tool.name}：TCP はフランジから ${c.tool.tcp[2] * 1000} mm 先。${toolCups}

# セル
${tbl}
- ワーク：${c.work.name}（${c.work.size.map(v => v * 1000).join('×')} mm、X×Y×高さ）。供給台の中央に置かれ、向きは X 方向が長辺。
- 床・台・ワークとの干渉はアラームで止まる。

# 入出力（シミュレーター内の割り当て）
${c.io}

# 書き方のルール
- ワークに近づくときは、真上 100mm 以上の位置に関節/直交移動 → ワーク位置へ直線移動（低速 100〜300mm/s）。離れるときも直線で真上に上げる。
- ハンド出力のあとは必ず確認入力を WAIT する（${c.sys === 'yaskawa' ? 'WAIT IN#(1)=ON' : 'WAIT RI[1]=ON'}）。解放後は短いタイマを入れる。
- 最初と最後は待機位置へ関節移動。
- 繰り返しはラベルとジャンプ、回数は変数で数える。複数段に積むときは位置変数・PR とオフセット（シフト）を使ってよい。
- 既存のプログラムを修正する指示の場合は、指示された部分だけを変え、それ以外の行と位置はそのまま返す。位置名も変えない。
- サブプログラムを作った場合は programs に一緒に入れる。
- 速度は控えめに（関節 50% 以下、直線 500mm/s 以下）。
- ワーク・台の近くの移動は ${c.sys === 'yaskawa' ? 'PL を付けない（PL=0）' : 'FINE'} にする。通過動作（${c.sys === 'yaskawa' ? 'PL' : 'CNT'}）は空中の経由点だけ。
- 開始時にハンド出力を OFF にする。置く前に排出台が空いていることを WAIT で確かめる（${c.sys === 'yaskawa' ? 'WAIT IN#(3)=OFF' : 'WAIT DI[2]=OFF'}）。
${c.sys === 'yaskawa' ? '- WAIT … T= は時間切れでも先へ進むので、使う場合は後で状態を確かめる。ラベルは 8 文字以内。' : '- 先頭に UFRAME_NUM=0 と UTOOL_NUM=1 を書く。WAIT … TIMEOUT,LBL[n] を使う場合は LBL[n] を必ず作る。プログラム名は英大文字で始め、英大文字・数字・_ だけ。コメントは 16 文字以内。'}

# 出力
JSON だけを返す（前後に文章を付けない）。形式：
{"explanation": "説明", "warnings": ["確認事項"], "programs": [{"name": "名前", "comment": "", "lines": ["命令", ...], "positions": [{"id": "${c.sys === 'yaskawa' ? 'C00000' : 'P[1]'}", "kind": "cart", "values": [X,Y,Z,a,b,c], "uf": 0}]}]}`;
  };

  RS.aiUserPrompt = function (c, instruction, mode) {
    const cur = c.prog;
    const posTxt = Object.entries(cur.pos).map(([k, p]) => p.k === 'j' ? `${k}: joint [${p.q.map(v => +v.toFixed(3)).join(', ')}]` : `${k}: cart [${['X', 'Y', 'Z', 'rx', 'ry', 'rz'].map(a => +p.p[a].toFixed(3)).join(', ')}] uf=${p.uf || 0}`).join('\n');
    const others = Object.keys(c.lib).filter(n => n !== cur.name);
    let s = '';
    if (mode === 'edit') {
      s += `# 修正するプログラム：${cur.name}\n命令：\n${cur.lines.map((l, i) => `${i + 1}: ${l}`).join('\n') || '（空）'}\n\n位置：\n${posTxt || '（なし）'}\n\n`;
    }
    if (others.length) s += `# 同じロボットにある他のプログラム（CALL 可）\n${others.join(', ')}\n\n`;
    s += `# 現在のロボットの TCP 位置\n${c.curPoseText}\n\n`;
    s += `# 指示\n${instruction}\n\n`;
    s += mode === 'edit' ? `プログラム ${cur.name} を修正して、全体（変えていない行と位置も含む）を返してください。` : `新しいプログラムを作ってください。`;
    return s;
  };

  /* Claude API を呼ぶ（ブラウザから直接） */
  RS.aiCall = async function (apiKey, system, user, signal) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: RS.AI_MODEL,
        max_tokens: 16000,
        fallbacks: 'default',
        output_config: { effort: 'high', format: { type: 'json_schema', schema: RS.AI_SCHEMA } },
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    let body;
    try { body = await res.json(); } catch (e) { throw new Error(`応答を読めません（HTTP ${res.status}）`); }
    if (!res.ok) {
      const msg = body && body.error && body.error.message ? body.error.message : '';
      if (res.status === 401) throw new Error('API キーが正しくありません');
      if (res.status === 429) throw new Error('混み合っています。少し待ってからもう一度押してください');
      if (res.status >= 500) throw new Error('AI 側のエラーです。もう一度押してください');
      throw new Error(`エラー（HTTP ${res.status}）${msg}`);
    }
    if (body.stop_reason === 'refusal') throw new Error('この指示には回答できませんでした。指示の書き方を変えてください');
    if (body.stop_reason === 'max_tokens') throw new Error('回答が長すぎて途中で切れました。指示を分けてください');
    const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return text;
  };

  /* 回答（JSON 文字列）を取り出して検査し、プログラムに変換する
   * 戻り値 { progs:[prog], explanation, warnings:[...] } もしくは { err } */
  RS.aiParse = function (text, sys, tool) {
    let s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b < a) return { err: '回答の中に JSON が見つかりません' };
    let o;
    try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return { err: 'JSON を読めません：' + e.message }; }
    if (!o || !Array.isArray(o.programs) || !o.programs.length) return { err: 'programs がありません' };
    const warns = Array.isArray(o.warnings) ? o.warnings.map(String) : [];
    const progs = [];
    for (const p of o.programs) {
      if (!p || !Array.isArray(p.lines)) return { err: 'lines がありません' };
      let name = RS.cleanName(p.name, sys) || ('AIPROG' + (progs.length + 1));
      for (let k = 2; progs.some(x => x.name === name); k++) name = RS.cleanName(String(p.name || 'AIPROG').slice(0, 28) + '_' + k, sys) || ('AIPROG' + k);
      const prog = RS.emptyProgram(sys, name, tool);
      prog.comment = RS.oneLine(p.comment).slice(0, 64);
      // 1 要素に改行が入っていたら、別の行として扱う（実機ファイルに見えない行が紛れ込まないように）
      prog.lines = p.lines.flatMap(l => String(l).split(/\r?\n|\r/)).map(l => l.replace(/^\s*\d+\s*:\s*/, '').replace(/;\s*$/, '').trim()).filter(l => l !== '');
      if (sys === 'yaskawa') prog.lines = prog.lines.filter(l => !/^(NOP|END)$/i.test(l));
      for (const q of (p.positions || [])) {
        if (!q || !Array.isArray(q.values) || q.values.length !== 6 || q.values.some(v => !isFinite(v))) { warns.push(`位置 ${q && q.id} の値が不正なため無視しました`); continue; }
        const id = String(q.id).trim().toUpperCase().replace(/^P\[(\d+)[^\]]*\]$/, 'P[$1]');
        if (q.kind === 'joint') prog.pos[id] = { k: 'j', q: q.values.map(Number) };
        else { const v = q.values.map(Number); prog.pos[id] = { k: 'c', p: { X: v[0], Y: v[1], Z: v[2], rx: v[3], ry: v[4], rz: v[5] }, cfg: 'N U T, 0, 0, 0', uf: +q.uf || 0, ut: 1 }; }
      }
      progs.push(prog);
    }
    return { progs, explanation: String(o.explanation || ''), warnings: warns };
  };
})(window.RS = window.RS || {});
