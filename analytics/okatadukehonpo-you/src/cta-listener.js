<script>
/* おかたづけ本舗You - CTAクリック計測リスナー
   GTMカスタムHTMLタグ / トリガー: All Pages
   tel: / mailto: / LINE リンクのクリックを dataLayer に流す。
   設置場所(cta_location)は data-cta 属性を最優先、無ければ祖先要素から推定する。 */
(function () {
  if (window.__youCtaListener) { return; }
  window.__youCtaListener = true;

  var dl = (window.dataLayer = window.dataLayer || []);
  var fired = {};

  /* --- 設置場所の推定。上から順に判定するので並び順が重要 --- */
  var LOCATION_RULES = [
    ['[data-cta]',                                                        null],
    ['[class*="fixed"],[class*="float"],[class*="sticky"],[id*="fixed"],[id*="float"],[class*="sp-cta"],[class*="spbtn"]', 'fixed_bar'],
    ['header,[class*="header"],[id*="header"],[class*="gnav"]',           'header'],
    ['[class*="mv"],[class*="hero"],[class*="fv"],[class*="keyvisual"],[class*="firstview"]', 'fv'],
    ['[class*="price"],[class*="ryokin"],[class*="fee"],[class*="plan"]', 'price'],
    ['[class*="case"],[class*="voice"],[class*="jirei"],[class*="works"]','case'],
    ['form,[class*="form"],[class*="contact"],[id*="contact"]',           'contact'],
    ['footer,[class*="footer"],[id*="footer"]',                           'footer']
  ];

  /* --- URLからサービス種別を判定。パスは実サイトに合わせて追記してください --- */
  var SERVICE_RULES = [
    ['/menu_details/organize', 'ihin_seiri'],
    ['/menu_details/collect',  'fuyouhin_kaishu'],
    ['gomiyashiki',            'gomiyashiki'],
    ['gomi-yashiki',           'gomiyashiki'],
    ['tokushu',                'tokushu_seisou'],
    ['tokusyu',                'tokushu_seisou'],
    ['cleaning',               'house_cleaning'],
    ['clean',                  'house_cleaning'],
    ['seizen',                 'seizen_seiri'],
    ['kaitori',                'kaitori']
  ];

  function detectLocation(el) {
    for (var i = 0; i < LOCATION_RULES.length; i++) {
      var hit = el.closest(LOCATION_RULES[i][0]);
      if (!hit) { continue; }
      if (LOCATION_RULES[i][1] === null) {
        var v = hit.getAttribute('data-cta');
        if (v) { return v; }
        continue;
      }
      return LOCATION_RULES[i][1];
    }
    return 'body';
  }

  function detectService() {
    var p = (location.pathname || '').toLowerCase();
    for (var i = 0; i < SERVICE_RULES.length; i++) {
      if (p.indexOf(SERVICE_RULES[i][0]) !== -1) { return SERVICE_RULES[i][1]; }
    }
    return p === '/' ? 'top' : 'other';
  }

  function detectType(a) {
    var override = a.getAttribute('data-cta-type');
    if (override) { return override; }
    var href = (a.getAttribute('href') || '').toLowerCase();
    if (href.indexOf('tel:') === 0) { return 'tel'; }
    if (href.indexOf('mailto:') === 0) { return 'mail'; }
    if (/lin\.ee|line\.me|line\.naver\.jp/.test(href)) { return 'line'; }
    return null;
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a,[data-cta-type]') : null;
    if (!a) { return; }

    var type = detectType(a);
    if (!type) { return; }

    var loc = detectLocation(a);
    var key = type + '|' + loc;
    /* 連打・誤タップの二重計上を防ぐため 1ページにつき 1組み合わせ 1回だけ */
    if (fired[key]) { return; }
    fired[key] = true;

    dl.push({
      event: 'cta_click',
      cta_type: type,
      cta_location: loc,
      cta_service: detectService()
    });
  }, true);
})();
</script>
