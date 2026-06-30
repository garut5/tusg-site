<?php
mb_language("Japanese");
mb_internal_encoding("UTF-8");

$to = "goandgoing53@gmail.com";

// フォーム受信
$subject      = $_POST['subject'] ?? '';
$company      = $_POST['companyName'] ?? '';
$name         = $_POST['name'] ?? '';
$email        = $_POST['email'] ?? '';
$phone        = $_POST['phone'] ?? '';
$inquiryType  = $_POST['inquiryType'] ?? '';
$message      = $_POST['message'] ?? '';

// お問い合わせ種別を日本語に変換
$inquiryLabels = [
    'marketing'   => 'マーケティング支援について',
    'sales'       => '営業代行について',
    'consulting'  => 'コンサルティングについて',
    'other'       => 'その他'
];

$inquiryText = $inquiryLabels[$inquiryType] ?? '未選択';

// 件名（文字化け防止）
$mail_subject = mb_encode_mimeheader("【TUSG】{$subject}", "UTF-8");

// 本文
$body  = "【TUSG お問い合わせ内容】\n\n";
$body .= "件名　　　　：{$subject}\n";
$body .= "お問い合わせ種別：{$inquiryText}\n";
$body .= "会社名　　　：{$company}\n";
$body .= "氏名　　　　：{$name}\n";
$body .= "メール　　　：{$email}\n";
$body .= "電話番号　　：{$phone}\n\n";
$body .= "【お問い合わせ内容】\n";
$body .= "{$message}\n";

// ヘッダー（迷惑メール・文字化け対策）
$headers  = "From: TUSG <no-reply@tusg.site>\r\n";
$headers .= "Reply-To: {$email}\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
$headers .= "Content-Transfer-Encoding: 8bit\r\n";

// 送信
mb_send_mail($to, $mail_subject, $body, $headers);

// サンクスページへ
header("Location: thanks.html");
exit;