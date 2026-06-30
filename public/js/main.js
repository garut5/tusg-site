// DOMContentLoaded イベント
 document.addEventListener('DOMContentLoaded', function() {
    // スムーズスクロール
    initSmoothScroll();
    
    // お問い合わせフォーム
    initContactForm();
    
    // モバイルメニュー
    initMobileMenu();
    
    // スクロール時のヘッダー制御
    initHeaderScroll();
});

// スムーズスクロール
function initSmoothScroll() {
    const navLinks = document.querySelectorAll('.nav-link, .hero-buttons a, .footer-nav-list a');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            
            if (href.startsWith('#')) {
                e.preventDefault();
                const targetElement = document.querySelector(href);
                
                if (targetElement) {
                    const headerHeight = document.querySelector('.header').offsetHeight;
                    const targetPosition = targetElement.offsetTop - headerHeight;
                    
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });
}

// お問い合わせフォーム
function initContactForm() {
    const contactForm = document.getElementById('contactForm');
    
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // フォームデータの取得
            const formData = new FormData(this);
            const data = Object.fromEntries(formData.entries());
            
            // バリデーション
            if (!validateContactForm(data)) {
                return;
            }
            
            // 送信処理（実際にはサーバーとの連携が必要）
            handleContactSubmit(data);
        });
    }
}

// フォームバリデーション
function validateContactForm(data) {
    const errors = [];
    
    // 会社名
    if (!data.companyName || data.companyName.trim().length < 2) {
        errors.push('会社名を正しく入力してください');
    }
    
    // 氏名
    if (!data.name || data.name.trim().length < 2) {
        errors.push('氏名を正しく入力してください');
    }
    
    // メールアドレス
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!data.email || !emailRegex.test(data.email)) {
        errors.push('有効なメールアドレスを入力してください');
    }
    
    // お問い合わせ内容
    if (!data.message || data.message.trim().length < 10) {
        errors.push('お問い合わせ内容を10文字以上入力してください');
    }
    
    if (errors.length > 0) {
        alert('入力内容に誤りがあります：\n\n' + errors.join('\n'));
        return false;
    }
    
    return true;
}

// フォーム送信処理
function handleContactSubmit(data) {
    // 実際の実装では、ここでサーバーにデータを送信します
    console.log('お問い合わせ送信データ:', data);
    
    // 成功メッセージの表示
    showSuccessMessage();
    
    // フォームのリセット
    document.getElementById('contactForm').reset();
}

// 成功メッセージの表示
function showSuccessMessage() {
    const successMessage = document.createElement('div');
    successMessage.innerHTML = `
        <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            text-align: center;
            z-index: 2000;
            max-width: 400px;
            width: 90%;
        ">
            <div style="font-size: 48px; margin-bottom: 20px;">✓</div>
            <h3 style="margin-bottom: 15px; color: var(--primary-green);">送信完了</h3>
            <p style="margin-bottom: 25px; line-height: 1.6;">
                お問い合わせありがとうございます。<br>
                内容を確認次第、担当者よりご連絡いたします。
            </p>
            <button onclick="this.parentElement.parentElement.remove()" style="
                background: var(--primary-green);
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 25px;
                cursor: pointer;
                font-size: 16px;
            ">閉じる</button>
        </div>
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1999;
        " onclick="this.parentElement.remove()"></div>
    `;
    
    document.body.appendChild(successMessage);
    
    // 5秒後に自動的に閉じる
    setTimeout(() => {
        if (successMessage.parentElement) {
            successMessage.remove();
        }
    }, 5000);
}

// モバイルメニュー
function initMobileMenu() {
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const nav = document.querySelector('.nav');
    
    if (mobileMenuBtn && nav) {
        mobileMenuBtn.addEventListener('click', function() {
            this.classList.toggle('active');
            nav.classList.toggle('active');
        });
    }
}

// スクロール時のヘッダー制御
function initHeaderScroll() {
    const header = document.querySelector('.header');
    let lastScrollTop = 0;
    
    window.addEventListener('scroll', function() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        if (scrollTop > lastScrollTop && scrollTop > 100) {
            // 下にスクロール
            header.style.transform = 'translateY(-100%)';
        } else {
            // 上にスクロール
            header.style.transform = 'translateY(0)';
        }
        
        lastScrollTop = scrollTop;
    });
}

// スクロールアニメーション（Intersection Observer）
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
        }
    });
}, observerOptions);

// アニメーション対象の要素を監視
document.addEventListener('DOMContentLoaded', function() {
    const animateElements = document.querySelectorAll('.business-card, .strength-item, .performance-stats');
    animateElements.forEach(el => observer.observe(el));
});

// CSSに追加するアニメーション用のクラス
const animationCSS = `
    .business-card, .strength-item, .performance-stats {
        opacity: 0;
        transform: translateY(30px);
        transition: all 0.6s ease;
    }
    
    .animate-in {
        opacity: 1 !important;
        transform: translateY(0) !important;
    }
    
    .header {
        transition: transform 0.3s ease;
    }
    
    .nav.active {
        display: block;
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
        padding: 20px;
    }
    
    .nav.active .nav-list {
        flex-direction: column;
        gap: 20px;
    }
    
    .mobile-menu-btn.active span:nth-child(1) {
        transform: rotate(45deg) translate(5px, 5px);
    }
    
    .mobile-menu-btn.active span:nth-child(2) {
        opacity: 0;
    }
    
    .mobile-menu-btn.active span:nth-child(3) {
        transform: rotate(-45deg) translate(7px, -6px);
    }
`;

// スタイルを追加
document.addEventListener('DOMContentLoaded', function() {
    const style = document.createElement('style');
    style.textContent = animationCSS;
    document.head.appendChild(style);
});

// ページ内リンクのスムーズスクロール
function scrollToSection(targetId) {
    const targetElement = document.querySelector(targetId);
    if (targetElement) {
        const headerHeight = document.querySelector('.header').offsetHeight;
        const targetPosition = targetElement.offsetTop - headerHeight;
        
        window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
        });
    }
}

// エラーハンドリング
window.addEventListener('error', function(e) {
    console.error('JavaScriptエラー:', e.error);
});

// フォームの自動保存機能（ローカルストレージ）
function initAutoSave() {
    const form = document.getElementById('contactForm');
    if (!form) return;
    
    const formFields = form.querySelectorAll('input, textarea');
    const formKey = 'tusg_contact_form';
    
    // 保存されたデータを復元
    const savedData = localStorage.getItem(formKey);
    if (savedData) {
        try {
            const data = JSON.parse(savedData);
            Object.keys(data).forEach(key => {
                const field = form.querySelector(`[name="${key}"]`);
                if (field) {
                    field.value = data[key];
                }
            });
        } catch (e) {
            console.warn('保存されたフォームデータの読み込みに失敗しました');
        }
    }
    
    // 入力時に自動保存
    formFields.forEach(field => {
        field.addEventListener('input', function() {
            const currentData = {};
            formFields.forEach(f => {
                currentData[f.name] = f.value;
            });
            localStorage.setItem(formKey, JSON.stringify(currentData));
        });
    });
    
    // フォーム送信成功時に保存データをクリア
    const originalHandleContactSubmit = handleContactSubmit;
    handleContactSubmit = function(data) {
        localStorage.removeItem(formKey);
        originalHandleContactSubmit(data);
    };
}

// 自動保存機能を初期化
document.addEventListener('DOMContentLoaded', function() {
    initAutoSave();
});