import { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';

export class TransactionController {
  // Get all transactions (admin)
  async getAllTransactions(req: Request, res: Response) {
    try {
      const { status, user_id, order_id } = req.query;
      
      let query = supabaseAdmin
        .from('transactions')
        .select(`
          *,
          order:orders!transactions_order_id_fkey(id, order_number),
          user:users!transactions_user_id_fkey(id, first_name, last_name, email)
        `);

      // Apply filters
      if (status) {
        query = query.eq('payment_status', status as string);
      }

      if (user_id) {
        query = query.eq('user_id', user_id as string);
      }

      if (order_id) {
        query = query.eq('order_id', order_id as string);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        data: data || [],
      });
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch transactions',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Get transaction by ID
  async getTransactionById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const { data, error } = await supabaseAdmin
        .from('transactions')
        .select(`
          *,
          order:orders!transactions_order_id_fkey(id, order_number, total, status),
          user:users!transactions_user_id_fkey(id, first_name, last_name, email)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Error fetching transaction:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch transaction',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Refund a transaction
  async refundTransaction(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Fetch the transaction
      const { data: transaction, error: fetchError } = await supabaseAdmin
        .from('transactions')
        .select(`
          *,
          order:orders!transactions_order_id_fkey(id, order_number, status, payment_status)
        `)
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found',
        });
      }

      // Check if transaction can be refunded
      if (transaction.payment_status !== 'paid') {
        return res.status(400).json({
          success: false,
          message: 'Only paid transactions can be refunded',
        });
      }

      if (transaction.payment_status === 'refunded') {
        return res.status(400).json({
          success: false,
          message: 'Transaction has already been refunded',
        });
      }

      // Update transaction status to refunded
      const { data: updatedTransaction, error: updateError } = await supabaseAdmin
        .from('transactions')
        .update({
          payment_status: 'refunded',
          status: 'refunded',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      // If transaction is linked to an order, update order payment status
      if (transaction.order_id && transaction.order) {
        const orderStatus = transaction.order.status;
        
        // If order is cancelled or can be cancelled, update payment status
        if (orderStatus === 'cancelled' || orderStatus === 'pending') {
          await supabaseAdmin
            .from('orders')
            .update({
              payment_status: 'refunded',
              updated_at: new Date().toISOString(),
            })
            .eq('id', transaction.order_id);
        }
      }

      console.log(`✅ Transaction ${transaction.transaction_reference || id} refunded successfully`);

      res.json({
        success: true,
        message: 'Transaction refunded successfully',
        data: updatedTransaction,
      });
    } catch (error) {
      console.error('Error refunding transaction:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to refund transaction',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

