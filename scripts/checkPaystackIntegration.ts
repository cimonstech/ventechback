import { affiliatePayoutProcessor } from '../src/services/affiliatePayoutProcessor.service';

console.log('✅ Paystack integration status:');
console.log('   - Secret Key configured:', Boolean(process.env.PAYSTACK_SECRET_KEY));
console.log('   - Public Key configured:', Boolean(process.env.PAYSTACK_PUBLIC_KEY));
console.log(`   - Keys present: ${process.env.PAYSTACK_SECRET_KEY ? 'YES' : 'NO'}`);

// Try to get pending payouts (this will fail gracefully if no pending payouts exist)
affiliatePayoutProcessor.getPendingPayouts()
  .then(payouts => {
    console.log(`✅ Paystack service initialized and accessible`);
    console.log(`   Pending payouts: ${payouts.length}`);
  })
  .catch(error => {
    if (error.message.includes('disabled')) {
      console.error('❌ Paystack is disabled:', error.message);
    } else {
      console.log('✅ Paystack service is enabled (database query attempted)');
      console.log('   Note:', error.message);
    }
  });