<?php
mb_language("Japanese");
mb_internal_encoding("UTF-8");

$to = "goandgoing53@gmail.com";
$subject = "【TUSG】お問い合わせがありました";

$company = htmlspecialchars($_POST['companyName'], ENT_QUOTES);
$name    = htmlspecialchars($_POST['name'], ENT_QUOTES);
$email   = htmlspecialchars($_POST['email'], ENT_QUOTES);
$phone   = htmlspecialchars($_POST['phone'], ENT_QUOTES);
$message = htmlspecialchars($_POST['message'], ENT_QUOTES);

$body  = "【会社名】\n{$company}\n\n";
$body .= "【お名前】\n{$name}\n\n";
$body .= "【メールアドレス】\n{$email}\n\n";
$body .= "【電話番号】\n{$phone}\n\n";
$body .= "【お問い合わせ内容】\n{$message}\n";

$headers = "From: {$email}";

mb_send_mail($to, $subject, $body, $headers);

header("Location: thanks.html");
exit;