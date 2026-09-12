<script>
/* おかたづけ本舗You - フォーム計測リスナー (Contact Form 7 用)
   GTMカスタムHTMLタグ / トリガー: All Pages
   CF7以外(MW WP Form / Snow Monkey Forms)の場合はサンクスページのPVトリガーを使うので
   このタグは無効化してよい。 */
(function () {
  if (window.__youFormListener) { return; }
  window.__youFormListener = true;
  var dl = (window.dataLayer = window.dataLayer || []);

  function push(name, e) {
    dl.push({
      event: name,
      /* フォームIDのみ。入力値は絶対に送らない */
      form_id: (e && e.detail && e.detail.contactFormId) ? String(e.detail.contactFormId) : 'unknown'
    });
  }

  document.addEventListener('wpcf7mailsent', function (e) { push('cf7_mailsent', e); }, false);
  document.addEventListener('wpcf7invalid', function (e) { push('cf7_invalid', e); }, false);
  document.addEventListener('wpcf7mailfailed', function (e) { push('cf7_mailfailed', e); }, false);
})();
</script>
