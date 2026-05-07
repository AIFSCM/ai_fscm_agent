async function callAgent(userMessage, conversationId) {
  try {
    const msg = userMessage.toLowerCase();

    // Query 1 — Pending approval invoices
    if (msg.includes('pending') || msg.includes('approval')) {
      const res = await axios.get(
        `${FUSION_HOST}/fscmRestApi/resources/11.13.18.05/invoices?q=ApprovalStatus=Required&limit=5`,
        {
          auth: { username: FUSION_USER, password: FUSION_PASS },
          headers: { 'Content-Type': 'application/json' }
        }
      );
      const invoices = res.data.items || [];
      if (invoices.length === 0) {
        return { reply: 'No invoices pending approval found.', conversationId: null };
      }
      let reply = `📋 *AP Invoices Pending Approval* (${invoices.length} found)\n\n`;
      invoices.forEach((inv, i) => {
        reply += `${i + 1}. Invoice #${inv.InvoiceNumber}\n`;
        reply += `   Supplier: ${inv.Supplier}\n`;
        reply += `   Amount: ${inv.InvoiceCurrency} ${inv.InvoiceAmount}\n`;
        reply += `   Date: ${inv.InvoiceDate}\n`;
        reply += `   Status: ${inv.ApprovalStatus}\n\n`;
      });
      return { reply, conversationId: null };
    }

    // Query 2 — Unpaid invoices
    if (msg.includes('unpaid') || msg.includes('outstanding')) {
      const res = await axios.get(
        `${FUSION_HOST}/fscmRestApi/resources/11.13.18.05/invoices?q=PaidStatus=Unpaid&limit=5`,
        {
          auth: { username: FUSION_USER, password: FUSION_PASS },
          headers: { 'Content-Type': 'application/json' }
        }
      );
      const invoices = res.data.items || [];
      if (invoices.length === 0) {
        return { reply: 'No unpaid invoices found.', conversationId: null };
      }
      let reply = `💰 *Unpaid AP Invoices* (${invoices.length} found)\n\n`;
      invoices.forEach((inv, i) => {
        reply += `${i + 1}. Invoice #${inv.InvoiceNumber}\n`;
        reply += `   Supplier: ${inv.Supplier}\n`;
        reply += `   Amount: ${inv.InvoiceCurrency} ${inv.InvoiceAmount}\n`;
        reply += `   Date: ${inv.InvoiceDate}\n`;
        reply += `   Terms: ${inv.PaymentTerms}\n\n`;
      });
      return { reply, conversationId: null };
    }

    // Query 3 — Search by supplier name
    if (msg.includes('supplier') || msg.includes('vendor')) {
      const words   = userMessage.split(' ');
      const lastWord = words[words.length - 1].toUpperCase();
      const res = await axios.get(
        `${FUSION_HOST}/fscmRestApi/resources/11.13.18.05/invoices?q=Supplier=${lastWord}&limit=5`,
        {
          auth: { username: FUSION_USER, password: FUSION_PASS },
          headers: { 'Content-Type': 'application/json' }
        }
      );
      const invoices = res.data.items || [];
      if (invoices.length === 0) {
        return { reply: `No invoices found for supplier: ${lastWord}`, conversationId: null };
      }
      let reply = `🏢 *Invoices for ${lastWord}* (${invoices.length} found)\n\n`;
      invoices.forEach((inv, i) => {
        reply += `${i + 1}. Invoice #${inv.InvoiceNumber}\n`;
        reply += `   Amount: ${inv.InvoiceCurrency} ${inv.InvoiceAmount}\n`;
        reply += `   Date: ${inv.InvoiceDate}\n`;
        reply += `   Status: ${inv.ValidationStatus}\n\n`;
      });
      return { reply, conversationId: null };
    }

    // Query 4 — Latest invoices (default)
    const res = await axios.get(
      `${FUSION_HOST}/fscmRestApi/resources/11.13.18.05/invoices?limit=5&orderBy=InvoiceDate:desc`,
      {
        auth: { username: FUSION_USER, password: FUSION_PASS },
        headers: { 'Content-Type': 'application/json' }
      }
    );
    const invoices = res.data.items || [];
    if (invoices.length === 0) {
      return { reply: 'No invoices found.', conversationId: null };
    }
    let reply = `📄 *Latest AP Invoices* (${invoices.length} shown)\n\n`;
    invoices.forEach((inv, i) => {
      reply += `${i + 1}. Invoice #${inv.InvoiceNumber}\n`;
      reply += `   Supplier: ${inv.Supplier}\n`;
      reply += `   Amount: ${inv.InvoiceCurrency} ${inv.InvoiceAmount}\n`;
      reply += `   Date: ${inv.InvoiceDate}\n`;
      reply += `   Status: ${inv.ValidationStatus}\n\n`;
    });

    // Help menu
    reply += `💡 *You can ask:*\n`;
    reply += `• Show pending approval invoices\n`;
    reply += `• Show unpaid invoices\n`;
    reply += `• Show invoices for supplier FAITH MOVERS\n`;
    reply += `• Show latest invoices\n`;

    return { reply, conversationId: null };

  } catch (err) {
    console.error('Agent error:', JSON.stringify(err.response?.data || err.message));
    return {
      reply         : 'Error connecting to Oracle. Please try again later.',
      conversationId: null
    };
  }
}
