<?php
/**
 * Google広告 通話コンバージョン用スニペットを <head> に出力する。
 * 子テーマの functions.php の末尾に貼り付けて使う。
 * テーマに「head内にコードを追加」欄がある場合や、WPCode等のプラグインを
 * 使っている場合は、そちらにHTMLを貼るほうが安全（テーマ更新の影響を受けない）。
 */
add_action( 'wp_head', function () {
	// 管理画面や不要な環境では出力しない
	if ( is_admin() ) {
		return;
	}
	?>
	<!-- Google tag (gtag.js) - Google広告 -->
	<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18308126022"></script>
	<script>
		window.dataLayer = window.dataLayer || [];
		function gtag(){dataLayer.push(arguments);}
		gtag('js', new Date());
		gtag('config', 'AW-18308126022');
		/* 下のIDと電話番号は、発行された電話番号スニペットの値に差し替えること */
		gtag('config', 'AW-18308126022/XXXXXXXXXXXXXXXXXXX', {
			'phone_conversion_number': '072-377-6933'
		});
	</script>
	<?php
}, 1 );
