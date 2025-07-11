// In file: netlify/functions/create-checkout.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');

const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTop8QquRL7r7mMKvqhykzToixh0YvpCEfAeOemvRdQKDznIQYIPT7O-Zl_WkTOxQ/pub?gid=962854917&single=true&output=csv';

// Function to securely get the latest prices from your Google Sheet
const getAuthoritativeProducts = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Cannot fetch menu from Google Sheet.');
    const csvText = await response.text();
    const rows = csvText.trim().split(/\r?\n/).slice(1);
    const products = {};
    rows.forEach(row => {
        const cells = row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
        if (cells.length >= 2) {
            const name = cells[0];
            const price = parseFloat((cells[1] || "0").replace('$', ''));
            if (name && !isNaN(price)) products[name] = { price: price };
        }
    });
    return products;
};

exports.handler = async (event) => {
    try {
        const { items, customer } = JSON.parse(event.body);
        const serverProducts = await getAuthoritativeProducts(GOOGLE_SHEET_URL);

        let totalAmount = 0;
        const itemDetailsForDescription = [];

        items.forEach(item => {
            const serverProduct = serverProducts[item.name];
            if (!serverProduct) throw new Error(`Product "${item.name}" not found.`);
            totalAmount += serverProduct.price * item.quantity;
            itemDetailsForDescription.push(`${item.quantity} x ${item.name}`);
        });
        
        const line_items = [{
            price_data: {
                currency: 'aud',
                product_data: {
                    name: 'Fuel & Prep Co Order',
                    description: itemDetailsForDescription.join(', '),
                },
                unit_amount: Math.round(totalAmount * 100), // Price in cents
            },
            quantity: 1,
        }];
        
        // This URL is provided by Netlify during build
        const siteUrl = process.env.URL || 'http://localhost:8888';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: line_items,
            mode: 'payment',
            success_url: `${siteUrl}?payment=success`,
            cancel_url: `${siteUrl}?payment=cancelled`,
            customer_email: customer.email,
            // This metadata is where all your custom data gets saved for Zapier
            metadata: {
                customer_name: customer.name,
                phone: customer.phone,
                address: customer.address,
                delivery_day: customer.deliveryDay,
                notes: customer.notes,
                items_ordered: itemDetailsForDescription.join('\n')
            }
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ id: session.id }),
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};