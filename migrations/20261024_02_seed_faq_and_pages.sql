-- Seeds FAQs and the four store policy pages from the hardcoded frontend copy.
-- Do not run this file from the app. Apply it in the database SQL editor.
-- affiliate-terms and laptop-banking-terms stay empty drafts.

BEGIN;

DELETE FROM public.faqs
WHERE question IN (
  'How long does delivery take?',
  'Do you offer free delivery?',
  'Can I track my order?',
  'Can I change or cancel my order?',
  'What payment methods do you accept?',
  'Is it safe to pay online?',
  'Do you accept installment payments?',
  'What is your return policy?',
  'How do I return an item?',
  'How long do refunds take?',
  'Can I exchange a product?',
  'Are all products brand new?',
  'Do products come with warranty?',
  'What if I receive a defective product?',
  'Can I request a product not listed on your site?',
  'How do I create an account?',
  'I forgot my password. What should I do?',
  'Is my personal information secure?',
  'What is VENTECH Laptop Banking?',
  'How do I start investing?',
  'Is Laptop Banking safe?',
  'What are Premium Stars?'
);

INSERT INTO public.faqs (category_id, question, answer_html, status, sort_order)
SELECT c.id, v.question, v.answer_html, 'published', v.sort_order
FROM (
  VALUES
    (
      'Orders & Shipping'::text,
      1,
      'How long does delivery take?'::text,
      $a$<p>Delivery typically takes 1-3 business days within Accra and Ho, and 3-5 business days for other regions in Ghana. Orders placed before 2 PM are processed the same day.</p>$a$
    ),
    (
      'Orders & Shipping',
      2,
      'Do you offer free delivery?',
      $a$<p>Yes. The regular delivery fee is waived when the regular-item subtotal reaches GHS 20,000. Below that amount, the delivery fee shown at checkout applies.</p>$a$
    ),
    (
      'Orders & Shipping',
      3,
      'Can I track my order?',
      $a$<p>Absolutely! Once your order is shipped, you'll receive a tracking number via email and SMS. You can also track your order status in your account dashboard.</p>$a$
    ),
    (
      'Orders & Shipping',
      4,
      'Can I change or cancel my order?',
      $a$<p>Yes, you can cancel or modify your order within 2 hours of placing it. After that, the order enters processing and cannot be changed. Contact us immediately at <a href="tel:+233551344310">+233 55 134 4310</a> if you need assistance.</p>$a$
    ),
    (
      'Payment',
      1,
      'What payment methods do you accept?',
      $a$<p>Online payments are made through Paystack by card, mobile money, or bank transfer. Cash on Delivery is available for eligible orders.</p>$a$
    ),
    (
      'Payment',
      2,
      'Is it safe to pay online?',
      $a$<p>Yes. Online payments are processed through Paystack. We never store your full payment card details.</p>$a$
    ),
    (
      'Payment',
      3,
      'Do you accept installment payments?',
      $a$<p>Currently, we don't offer installment payment plans directly. However, you may use third-party services like Bank installment plans if your card supports it.</p>$a$
    ),
    (
      'Returns & Refunds',
      1,
      'What is your return policy?',
      $a$<p>We offer a 7-day return policy for most products. Items must be unused, in original packaging, and in resalable condition. See our <a href="/returns">Returns page</a> for full details.</p>$a$
    ),
    (
      'Returns & Refunds',
      2,
      'How do I return an item?',
      $a$<p>Contact our customer service at <a href="mailto:ventechgadgets@gmail.com">ventechgadgets@gmail.com</a> or call <a href="tel:+233551344310">+233 55 134 4310</a> to initiate a return. We'll provide you with a return authorization and instructions.</p>$a$
    ),
    (
      'Returns & Refunds',
      3,
      'How long do refunds take?',
      $a$<p>Once we receive and inspect your returned item, refunds are processed within 5-7 business days. The refund will be credited to your original payment method.</p>$a$
    ),
    (
      'Returns & Refunds',
      4,
      'Can I exchange a product?',
      $a$<p>Yes! If you want a different size, color, or model, we can arrange an exchange. Contact us within 7 days of receiving your order.</p>$a$
    ),
    (
      'Products',
      1,
      'Are all products brand new?',
      $a$<p>Yes, all products sold on VENTECH are 100% brand new, authentic, and come with manufacturer warranties where applicable.</p>$a$
    ),
    (
      'Products',
      2,
      'Do products come with warranty?',
      $a$<p>Yes! Most products come with manufacturer warranties ranging from 3 months to 2 years depending on the product. Extended warranties are available for select items.</p>$a$
    ),
    (
      'Products',
      3,
      'What if I receive a defective product?',
      $a$<p>If you receive a defective or damaged product, contact us immediately within 48 hours. We'll arrange a replacement or full refund at no extra cost.</p>$a$
    ),
    (
      'Products',
      4,
      'Can I request a product not listed on your site?',
      $a$<p>Absolutely! Contact us with your request, and we'll do our best to source it for you. We have access to a wide network of suppliers.</p>$a$
    ),
    (
      'Account & Security',
      1,
      'How do I create an account?',
      $a$<p>Click "Register" in the navigation menu, fill in your details (name, email, phone, password), verify your email, and you're all set!</p>$a$
    ),
    (
      'Account & Security',
      2,
      'I forgot my password. What should I do?',
      $a$<p>Click "Forgot Password" on the login page, enter your email, and we'll send you a password reset link. Follow the instructions to create a new password.</p>$a$
    ),
    (
      'Account & Security',
      3,
      'Is my personal information secure?',
      $a$<p>Yes! We use industry-standard encryption (SSL/TLS) to protect your data. See our <a href="/privacy">Privacy Policy</a> for complete details on how we protect your information.</p>$a$
    ),
    (
      'Laptop Banking',
      1,
      'What is VENTECH Laptop Banking?',
      $a$<p>Laptop Banking is our investment program where you invest in our laptop trade business and earn monthly returns of 8-9% over 6 months. Your investment helps us bulk-purchase laptops for resale.</p>$a$
    ),
    (
      'Laptop Banking',
      2,
      'How do I start investing?',
      $a$<p>Visit our <a href="/laptop-banking">Laptop Banking page</a>, choose your investment tier (starting from GHS 2,500), fill out the application form, and our team will contact you with the investment agreement.</p>$a$
    ),
    (
      'Laptop Banking',
      3,
      'Is Laptop Banking safe?',
      $a$<p>Your investment is backed by real inventory and trade. We provide monthly returns with proof of payment. However, like any investment, returns are subject to market conditions.</p>$a$
    ),
    (
      'Laptop Banking',
      4,
      'What are Premium Stars?',
      $a$<p>Premium Stars allow investors to purchase up to 5 gadgets at supplier pricing (below retail). You get 5 stars with every investment, redeemable within your 6-month investment period.</p>$a$
    )
) AS v(category_name, sort_order, question, answer_html)
JOIN public.faq_categories c ON c.name = v.category_name;

UPDATE public.content_pages
SET
  body_html = $terms$
<p>Last updated: October 28, 2025</p>
<p>Welcome to VENTECH. By accessing and using our website (ventechgadgets.com) and services, you agree to be bound by these Terms of Service. Please read them carefully.</p>
<h2>1. Acceptance of Terms</h2>
<p>By creating an account, placing an order, or using any part of our service, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service and our Privacy Policy.</p>
<p>If you do not agree to these terms, please do not use our services.</p>
<h2>2. Eligibility</h2>
<p>You must be at least 18 years old to use our services. By using VENTECH, you represent and warrant that you meet this age requirement and have the legal capacity to enter into these Terms.</p>
<h2>3. Account Registration</h2>
<ul>
<li>You must provide accurate and complete information during registration</li>
<li>You are responsible for maintaining the confidentiality of your account credentials</li>
<li>You must notify us immediately of any unauthorized access to your account</li>
<li>You are responsible for all activities that occur under your account</li>
<li>We reserve the right to suspend or terminate accounts that violate these terms</li>
</ul>
<h2>4. Products &amp; Services</h2>
<p><strong>Product Information:</strong> We strive to provide accurate product descriptions, images, and pricing. However, we do not warrant that product descriptions or other content is accurate, complete, reliable, current, or error-free.</p>
<p><strong>Pricing:</strong> All prices are listed in Ghanaian Cedis (GHS) and are subject to change without notice. We reserve the right to modify prices at any time.</p>
<p><strong>Availability:</strong> Product availability is subject to stock. We reserve the right to limit quantities or discontinue any product at any time.</p>
<h2>5. Orders &amp; Payment</h2>
<p><strong>Order Acceptance:</strong> Your receipt of an order confirmation does not signify our acceptance of your order. We reserve the right to refuse or cancel any order for any reason.</p>
<p><strong>Payment Methods:</strong> We accept Mobile Money (MTN, Vodafone, AirtelTigo), credit/debit cards, and Cash on Delivery (COD) for eligible orders.</p>
<p><strong>Payment Security:</strong> All payment transactions are processed securely through Paystack. We do not store your full payment card details.</p>
<h2>6. Shipping &amp; Delivery</h2>
<ul>
<li>Delivery times are estimates and not guaranteed</li>
<li>We ship to addresses within Ghana (Accra, Ho, and other regions)</li>
<li>Free delivery available for orders over GHS 20,000</li>
<li>You are responsible for providing accurate delivery information</li>
<li>Risk of loss passes to you upon delivery to the carrier</li>
</ul>
<h2>7. Returns &amp; Refunds</h2>
<p>We offer a 7-day return policy for most products. Please see our <a href="/returns">Returns Policy</a> for detailed information.</p>
<p>Items must be unused, in original packaging, and in resalable condition to be eligible for return.</p>
<h2>8. VENTECH Laptop Banking</h2>
<p>Our Laptop Banking investment program is subject to separate terms and conditions provided during the application process. By investing, you acknowledge:</p>
<ul>
<li>Investment returns are subject to market conditions</li>
<li>Terms are 6 months (3 + 3) with early exit options</li>
<li>Premium membership benefits are non-transferable</li>
<li>Referral bonuses are subject to verification</li>
</ul>
<h2>9. Intellectual Property</h2>
<p>All content on VENTECH, including logos, text, graphics, images, and software, is the property of VENTECH or its licensors and is protected by Ghanaian and international copyright laws. You may not reproduce, distribute, or create derivative works without our express permission.</p>
<h2>10. Limitation of Liability</h2>
<p>To the fullest extent permitted by law, VENTECH shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of our services.</p>
<h2>11. Warranty Disclaimer</h2>
<p>Our services and products are provided "as is" without warranties of any kind. While we provide manufacturer warranties where applicable, we make no additional warranties regarding product performance or fitness for a particular purpose.</p>
<h2>12. Governing Law</h2>
<p>These Terms of Service shall be governed by and construed in accordance with the laws of Ghana. Any disputes arising under these terms shall be subject to the exclusive jurisdiction of the courts of Ghana.</p>
<h2>13. Changes to Terms</h2>
<p>We reserve the right to modify these Terms of Service at any time. We will notify users of material changes via email or website notification. Your continued use of our services after changes constitutes acceptance of the modified terms.</p>
<h2>Contact Us</h2>
<p>If you have any questions about these Terms of Service, please contact us:</p>
<ul>
<li><strong>Email:</strong> <a href="mailto:ventechgadgets@gmail.com">ventechgadgets@gmail.com</a></li>
<li><strong>Phone:</strong> <a href="tel:+233551344310">+233 55 134 4310</a></li>
<li><strong>Address:</strong> Ho Civic Center Shop #22, Ho, Ghana</li>
<li><strong>Address:</strong> Accra, Ghana</li>
</ul>
$terms$,
  status = 'published'
WHERE slug = 'terms';

UPDATE public.content_pages
SET
  body_html = $privacy$
<p>Last updated: October 28, 2025</p>
<p>At VENTECH, we respect your privacy and are committed to protecting your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website and services.</p>
<p>By using VENTECH, you consent to the practices described in this policy.</p>
<h2>1. Information We Collect</h2>
<h3>1.1 Personal Information</h3>
<p>When you create an account or make a purchase, we collect:</p>
<ul>
<li>Full name (first and last name)</li>
<li>Email address</li>
<li>Phone number</li>
<li>Shipping and billing addresses</li>
<li>Payment information (processed securely by our payment partners)</li>
<li>Date of birth and gender (optional)</li>
</ul>
<h3>1.2 Automatically Collected Information</h3>
<ul>
<li>IP address and browser type</li>
<li>Device information and operating system</li>
<li>Pages visited and time spent on our site</li>
<li>Referring website or source</li>
<li>Cookies and similar tracking technologies</li>
</ul>
<h3>1.3 Transaction Information</h3>
<ul>
<li>Order history and product preferences</li>
<li>Shopping cart contents</li>
<li>Wishlist items</li>
<li>Product reviews and ratings</li>
</ul>
<h2>2. How We Use Your Information</h2>
<p>We use your information to:</p>
<ul>
<li>Process and fulfill your orders</li>
<li>Communicate with you about your orders and account</li>
<li>Provide customer support and respond to inquiries</li>
<li>Send order confirmations, shipping updates, and receipts</li>
<li>Process payments securely</li>
<li>Personalize your shopping experience</li>
<li>Send promotional emails (with your consent)</li>
<li>Improve our website and services</li>
<li>Detect and prevent fraud</li>
<li>Comply with legal obligations</li>
</ul>
<h2>3. How We Share Your Information</h2>
<h3>3.1 Service Providers</h3>
<p>We share information with trusted third-party service providers who assist us in:</p>
<ul>
<li><strong>Payment Processing:</strong> Paystack (payment gateway)</li>
<li><strong>Shipping &amp; Delivery:</strong> Courier services</li>
<li><strong>Email Services:</strong> For transactional and marketing emails</li>
<li><strong>Cloud Storage:</strong> Supabase, Cloudflare R2</li>
<li><strong>Analytics:</strong> To understand website usage</li>
</ul>
<h3>3.2 Legal Requirements</h3>
<p>We may disclose your information if required by law, court order, or government request, or to protect our rights, property, or safety.</p>
<h3>3.3 Business Transfers</h3>
<p>In the event of a merger, acquisition, or sale of assets, your information may be transferred to the acquiring entity.</p>
<h2>4. Cookies and Tracking Technologies</h2>
<p>We use cookies and similar technologies to enhance your experience:</p>
<ul>
<li><strong>Essential Cookies:</strong> Required for site functionality (login, cart)</li>
<li><strong>Analytics Cookies:</strong> Help us understand how you use our site</li>
<li><strong>Preference Cookies:</strong> Remember your settings and preferences</li>
<li><strong>Marketing Cookies:</strong> Track marketing campaign effectiveness</li>
</ul>
<p>You can control cookies through your browser settings, but disabling them may affect site functionality.</p>
<h2>5. Data Security</h2>
<p>We implement industry-standard security measures to protect your information:</p>
<ul>
<li>SSL/TLS encryption for all data transmission</li>
<li>Secure password hashing and storage</li>
<li>Regular security audits and monitoring</li>
<li>Restricted access to personal information</li>
<li>Secure payment processing (PCI-DSS compliant partners)</li>
</ul>
<p>While we strive to protect your information, no method of transmission over the internet is 100% secure. We cannot guarantee absolute security.</p>
<h2>6. Your Privacy Rights</h2>
<p>You have the right to:</p>
<ul>
<li><strong>Access:</strong> Request a copy of your personal information</li>
<li><strong>Correction:</strong> Update or correct inaccurate information</li>
<li><strong>Deletion:</strong> Request deletion of your account and data</li>
<li><strong>Opt-Out:</strong> Unsubscribe from marketing emails at any time</li>
<li><strong>Data Portability:</strong> Request your data in a machine-readable format</li>
<li><strong>Object:</strong> Object to processing of your personal information</li>
</ul>
<p>To exercise these rights, contact us at <a href="mailto:ventechgadgets@gmail.com">ventechgadgets@gmail.com</a>.</p>
<h2>7. Data Retention</h2>
<p>We retain your personal information for as long as necessary to provide our services, comply with legal obligations, resolve disputes, and enforce our agreements. When you delete your account, we will delete or anonymize your personal information within 30 days, except where required by law to retain it longer.</p>
<h2>8. Children's Privacy</h2>
<p>VENTECH is not intended for individuals under the age of 18. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.</p>
<h2>9. Third-Party Links</h2>
<p>Our website may contain links to third-party websites. We are not responsible for the privacy practices of these external sites. We encourage you to review their privacy policies before providing any personal information.</p>
<h2>10. International Data Transfers</h2>
<p>Your information may be transferred to and processed in countries other than Ghana, including countries that may not have the same data protection laws. We ensure appropriate safeguards are in place to protect your information in accordance with this Privacy Policy.</p>
<h2>11. Marketing Communications</h2>
<p>With your consent, we may send you:</p>
<ul>
<li>Promotional emails about new products and special offers</li>
<li>SMS notifications about exclusive deals</li>
<li>Newsletter with tech tips and updates</li>
</ul>
<p>You can opt-out at any time by clicking the "Unsubscribe" link in our emails or updating your preferences in your account settings.</p>
<h2>12. Changes to This Privacy Policy</h2>
<p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the "Last updated" date. Your continued use of our services after changes constitutes acceptance of the updated policy.</p>
<h2>Contact Us About Privacy</h2>
<p>If you have questions or concerns about this Privacy Policy or our data practices, please contact us:</p>
<ul>
<li><strong>Email:</strong> <a href="mailto:ventechgadgets@gmail.com">ventechgadgets@gmail.com</a></li>
<li><strong>Phone:</strong> <a href="tel:+233551344310">+233 55 134 4310</a></li>
<li><strong>Address:</strong> Ho Civic Center Shop #22, Ho, Ghana</li>
<li><strong>Address:</strong> Accra, Ghana</li>
</ul>
$privacy$,
  status = 'published'
WHERE slug = 'privacy';

UPDATE public.content_pages
SET
  body_html = $returns$
<p>We want you to be completely satisfied with your purchase. Learn about our return policy.</p>
<h2>7-Day Returns</h2>
<p>Return eligible items within 7 days of delivery.</p>
<h2>Easy Returns</h2>
<p>Simple return process with full refund.</p>
<h2>Quality Guaranteed</h2>
<p>Defective items replaced at no cost.</p>
<h2>Return Eligibility</h2>
<h3>Eligible for Return</h3>
<ul>
<li>Item is unused and in original condition</li>
<li>All original packaging, tags, and accessories included</li>
<li>Return requested within 7 days of delivery</li>
<li>Product is in resalable condition</li>
<li>Defective or damaged items (any time)</li>
<li>Wrong item received</li>
</ul>
<h3>Not Eligible for Return</h3>
<ul>
<li>Items used, damaged, or altered by customer</li>
<li>Missing original packaging or accessories</li>
<li>Software products with broken seals</li>
<li>Personalized or custom-ordered items</li>
<li>Items on clearance or final sale</li>
<li>Returns requested after 7 days (unless defective)</li>
</ul>
<h2>How to Return an Item</h2>
<h3>1. Contact Us</h3>
<p>Reach out to our customer service team within 7 days of receiving your order:</p>
<ul>
<li>Email: <a href="mailto:ventechgadgets@gmail.com">ventechgadgets@gmail.com</a></li>
<li>Phone: <a href="tel:+233551344310">+233 55 134 4310</a></li>
</ul>
<h3>2. Get Return Authorization</h3>
<p>Provide your order number, reason for return, and photos if applicable. Our team will review your request and provide a Return Authorization (RA) number and instructions.</p>
<h3>3. Package the Item</h3>
<p>Carefully pack the item in its original packaging with all accessories, manuals, and tags. Include a copy of your invoice and the RA number inside the package.</p>
<h3>4. Ship or Drop Off</h3>
<p><strong>Option A:</strong> Ship the package to our return address (provided in your RA email).</p>
<p><strong>Option B:</strong> Drop off at our offices in Accra or Ho (Ho Civic Center Shop #22).</p>
<h3>5. Inspection &amp; Refund</h3>
<p>Once we receive and inspect your return (1-2 business days), we'll process your refund or exchange. Refunds are issued within 5-7 business days to your original payment method.</p>
<h2>Refund Information</h2>
<h3>Refund Processing Time</h3>
<ul>
<li>Inspection: 1-2 business days after we receive your return</li>
<li>Refund processing: 5-7 business days</li>
<li>Bank processing time may vary (allow an additional 3-5 days)</li>
</ul>
<h3>Refund Method</h3>
<p>Refunds are issued to the original payment method:</p>
<ul>
<li><strong>Mobile Money:</strong> Instant to same number</li>
<li><strong>Credit/Debit Card:</strong> 5-10 business days</li>
<li><strong>Cash on Delivery:</strong> Bank transfer or MoMo (provide details)</li>
</ul>
<h3>Shipping Costs</h3>
<ul>
<li>Original shipping fees are non-refundable (unless item was defective/wrong)</li>
<li>Return shipping costs are the customer's responsibility (unless item was defective/wrong)</li>
<li>For defective or wrong items, we provide a prepaid return label</li>
</ul>
<h2>Exchanges</h2>
<p>We gladly offer exchanges for a different size, color, or model of the same product. Follow the same return process and indicate you'd like an exchange instead of a refund.</p>
<ul>
<li>Exchanges are subject to product availability</li>
<li>Price differences may apply and will be charged or refunded accordingly</li>
<li>Exchanges are processed within 3-5 business days after receiving the original item</li>
</ul>
<h2>Returns vs. Warranty</h2>
<p><strong>Returns (7 days):</strong> For change of mind, wrong item, or items that don't meet expectations. Item must be unused and in original condition.</p>
<p><strong>Warranty Claims (after 7 days):</strong> For defects or malfunctions covered by manufacturer warranty. Contact us with your warranty card and purchase proof.</p>
<h2>Received a Defective Item?</h2>
<p>If you receive a defective, damaged, or wrong item:</p>
<ul>
<li>Contact us immediately (within 48 hours preferred)</li>
<li>Provide photos/videos of the defect or damage</li>
<li>We'll arrange a free replacement or full refund</li>
<li>We cover all return shipping costs for defective items</li>
</ul>
<p><strong>Your satisfaction is our priority. We'll make it right!</strong></p>
<h2>Need Help With a Return?</h2>
<p>Our customer service team is here to assist you.</p>
<ul>
<li>Call: <a href="tel:+233551344310">+233 55 134 4310</a></li>
<li>Email: <a href="mailto:ventechgadgets@gmail.com">ventechgadgets@gmail.com</a></li>
</ul>
$returns$,
  status = 'published'
WHERE slug = 'returns';

UPDATE public.content_pages
SET
  body_html = $shipping$
<p>Fast, reliable delivery across Ghana. Get your tech gadgets delivered to your doorstep.</p>
<h2>Fast Delivery</h2>
<p>1-3 days in Accra and Ho. 3-5 days nationwide.</p>
<h2>Free delivery</h2>
<p>The regular delivery fee is waived when the regular-item subtotal reaches GHS 20,000.</p>
<h2>Order Tracking</h2>
<p>Real-time updates via SMS and email.</p>
<h2>Delivery times</h2>
<ul>
<li><strong>Accra</strong> (Greater Accra Region): 1-2 business days</li>
<li><strong>Ho</strong> (Volta Region): 1-3 business days</li>
<li><strong>Kumasi</strong> (Ashanti Region): 2-4 business days</li>
<li><strong>Tamale</strong> (Northern Region): 3-5 business days</li>
<li><strong>Other Regions</strong> (Cape Coast, Takoradi, Sunyani, etc.): 3-5 business days</li>
</ul>
<p>Delivery options and fees are shown at checkout.</p>
<p><strong>Note:</strong> Orders placed before 2:00 PM are processed the same day. Orders placed after 2:00 PM will be processed the next business day.</p>
<h2>How Shipping Works</h2>
<h3>1. Order Confirmation</h3>
<p>After you place your order, you'll receive an email confirmation with your order details and estimated delivery date.</p>
<h3>2. Order Processing</h3>
<p>Our team prepares your order, quality checks all items, and carefully packages them for safe delivery.</p>
<h3>3. Shipment</h3>
<p>Your order is handed to our courier partner. You'll receive a tracking number via email and SMS.</p>
<h3>4. Delivery</h3>
<p>Our courier will contact you before delivery. Please ensure someone is available to receive the package and provide ID for verification.</p>
<h2>Delivery Coverage</h2>
<p>We currently deliver to all regions in Ghana, including:</p>
<ul>
<li>Greater Accra Region</li>
<li>Volta Region (Ho, Hohoe, Keta, etc.)</li>
<li>Ashanti Region (Kumasi and surrounding)</li>
<li>Northern Region (Tamale, Bolgatanga)</li>
<li>Western Region (Takoradi, Tarkwa)</li>
<li>Central Region (Cape Coast, Kasoa)</li>
<li>Eastern Region (Koforidua, Mpraeso)</li>
<li>And all other regions!</li>
</ul>
<h2>Important Delivery Information</h2>
<ul>
<li>Please provide accurate delivery address and contact information</li>
<li>Recipient must provide valid ID for verification upon delivery</li>
<li>Inspect your package before signing for delivery</li>
<li>Report any damage or missing items within 24 hours</li>
<li>Delivery times may vary during peak seasons and holidays</li>
</ul>
<h2>Questions About Your Delivery?</h2>
<p>Contact our support team for assistance.</p>
<ul>
<li>Call: <a href="tel:+233551344310">+233 55 134 4310</a></li>
<li>Email: <a href="mailto:ventechgadgets@gmail.com">ventechgadgets@gmail.com</a></li>
</ul>
$shipping$,
  status = 'published'
WHERE slug = 'shipping';

DO $check$
BEGIN
  IF (
    SELECT count(*)
    FROM public.faqs
    WHERE question IN (
      'How long does delivery take?',
      'Do you offer free delivery?',
      'Can I track my order?',
      'Can I change or cancel my order?',
      'What payment methods do you accept?',
      'Is it safe to pay online?',
      'Do you accept installment payments?',
      'What is your return policy?',
      'How do I return an item?',
      'How long do refunds take?',
      'Can I exchange a product?',
      'Are all products brand new?',
      'Do products come with warranty?',
      'What if I receive a defective product?',
      'Can I request a product not listed on your site?',
      'How do I create an account?',
      'I forgot my password. What should I do?',
      'Is my personal information secure?',
      'What is VENTECH Laptop Banking?',
      'How do I start investing?',
      'Is Laptop Banking safe?',
      'What are Premium Stars?'
    )
  ) <> 22 THEN
    RAISE EXCEPTION 'Expected 22 seeded FAQ rows';
  END IF;

  IF (
    SELECT count(*)
    FROM public.content_pages
    WHERE slug IN ('terms', 'privacy', 'returns', 'shipping')
      AND status = 'published'
      AND length(body_html) > 0
  ) <> 4 THEN
    RAISE EXCEPTION 'Expected four published policy pages';
  END IF;

  IF (
    SELECT count(*)
    FROM public.content_pages
    WHERE slug IN ('affiliate-terms', 'laptop-banking-terms')
      AND status = 'draft'
      AND body_html = ''
  ) <> 2 THEN
    RAISE EXCEPTION 'Affiliate and Laptop Banking pages must stay empty drafts';
  END IF;
END
$check$;

COMMIT;
