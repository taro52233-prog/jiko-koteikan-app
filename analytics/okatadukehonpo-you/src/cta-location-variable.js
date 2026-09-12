/* GTM カスタムJavaScript変数: JS - CTA設置場所
   クリックされた要素から、CTAがページのどこに置かれているかを判定する。
   data-cta 属性があればそれを最優先。無ければ祖先要素のclass/idから推定する。
   ※ 組み込み変数「Click Element」が有効である必要がある。 */
function () {
  var el = {{Click Element}};
  if (!el || !el.closest) { return 'unknown'; }

  var explicit = el.closest('[data-cta]');
  if (explicit && explicit.getAttribute('data-cta')) {
    return explicit.getAttribute('data-cta');
  }

  /* 上から順に判定するので並び順が重要。追従バーはfooter内にあることが多いので先に判定する */
  var rules = [
    ['[class*="fixed"],[class*="float"],[class*="sticky"],[id*="fixed"],[id*="float"],[class*="sp-cta"]', 'fixed_bar'],
    ['header,[class*="header"],[id*="header"],[class*="gnav"]', 'header'],
    ['[class*="mv"],[class*="hero"],[class*="fv"],[class*="keyvisual"],[class*="firstview"]', 'fv'],
    ['[class*="price"],[class*="ryokin"],[class*="fee"],[class*="plan"]', 'price'],
    ['[class*="case"],[class*="voice"],[class*="jirei"],[class*="works"]', 'case'],
    ['form,[class*="form"],[class*="contact"],[id*="contact"]', 'contact'],
    ['footer,[class*="footer"],[id*="footer"]', 'footer']
  ];

  for (var i = 0; i < rules.length; i++) {
    if (el.closest(rules[i][0])) { return rules[i][1]; }
  }
  return 'body';
}
