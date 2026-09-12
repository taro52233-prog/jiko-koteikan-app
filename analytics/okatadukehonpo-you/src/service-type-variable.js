/* GTM カスタムJavaScript変数: JS - サービス種別
   URLのパスから、どのサービスのページで発生したイベントかを判定する。
   パスは実サイトの構成に合わせて追記・修正してください。 */
function () {
  var p = (document.location.pathname || '').toLowerCase();

  var rules = [
    ['/menu_details/organize', 'ihin_seiri'],
    ['/menu_details/collect',  'fuyouhin_kaishu'],
    ['gomiyashiki',            'gomiyashiki'],
    ['gomi-yashiki',           'gomiyashiki'],
    ['seizen',                 'seizen_seiri'],
    ['tokushu',                'tokushu_seisou'],
    ['tokusyu',                'tokushu_seisou'],
    ['clean',                  'house_cleaning'],
    ['kaitori',                'kaitori']
  ];

  for (var i = 0; i < rules.length; i++) {
    if (p.indexOf(rules[i][0]) !== -1) { return rules[i][1]; }
  }
  return p === '/' ? 'top' : 'other';
}
