const qrcode = require('qrcode-terminal');
const { Client, MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');

const client = new Client();
let carrinhos = {}; // { "5511999999999": {itens: [], estado: "...", ultimoEnvioPdf: timestamp, atendenteTimer: null} }

const cardapio = {
    lanches: [
        { id: 1, nome: "🍔 Smash Burger Clássico", preco: 20.00 },
        { id: 2, nome: "🥗 Smash! Salada", preco: 23.00 },
        { id: 3, nome: "🥓 Salada Bacon", preco: 27.00 },
        { id: 4, nome: "🍔🍔🍔 Smash!! Triple", preco: 28.00 },
        { id: 5, nome: "🍔🥓 Smash Burger Bacon", preco: 29.99 },
        { id: 6, nome: "🍔🍖️ Burger Calabacon", preco: 32.99 }
    ],
    bebidas: [
        { id: 7, nome: "🥤 Coca-Cola 2L", preco: 12.00 },
        { id: 8, nome: "🥤 Poty Guaraná 2L", preco: 10.00 },
        { id: 9, nome: "🥤 Coca-Cola Lata", preco: 6.00 },
        { id: 10, nome: "🥤 Guaraná Lata", preco: 6.00 }
    ]
};

const PDF_PATH = '/home/engeve/Documentos/botdelivery/cardapio.pdf';

function formatarTroco(troco) {
    if (troco.toLowerCase() === 'não' || troco.toLowerCase() === 'nao') {
        return 'não';
    }
    // Extrai números e formata como R$ XX,XX
    const numeros = troco.replace(/[^\d,.]/g, '').replace('.', ',');
    const partes = numeros.split(',');
    let inteiro = partes[0] || '0';
    let centavos = partes[1] ? partes[1].padEnd(2, '0').slice(0, 2) : '00';
    return `R$ ${inteiro},${centavos}`;
}

function gerarCupomFiscal(itens, endereco, formaPagamento = null, troco = null) {
    const total = itens.reduce((sum, item) => sum + item.preco, 0);
    const taxaEntrega = total * 0.1;
    const subtotal = total - taxaEntrega;
    const now = new Date();
    
    let cupom = `SMASH BURGER - Pedido em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}\n\n`;

    // Itens
    cupom += "ITENS:\n";
    itens.forEach(item => {
        cupom += `${item.id}. ${item.nome} - R$ ${item.preco.toFixed(2).replace('.', ',')}\n`;
    });

    // Totais
    cupom += `\nSubtotal: R$ ${subtotal.toFixed(2).replace('.', ',')}`;
    cupom += `\nTaxa de Entrega (10%): R$ ${taxaEntrega.toFixed(2).replace('.', ',')}`;
    cupom += `\nTOTAL: R$ ${total.toFixed(2).replace('.', ',')}\n`;

    // Endereço
    cupom += `\nENDEREÇO:\n${endereco}\n`;

    // Pagamento
    cupom += `\nFORMA DE PAGAMENTO:\n${formaPagamento}\n`;

    // Troco (se dinheiro)
    if (formaPagamento === "1. Dinheiro 💵" && troco) {
        cupom += `\nTroco para: ${formatarTroco(troco)}`;
    }

    return cupom;
}

function mostrarCardapio() {
    let msg = "🌟 *CARDÁPIO SMASH BURGER* 🌟\n\n";
    msg += "══════════════════════════\n";
    msg += "🍔 *LANCHES*\n";
    msg += "══════════════════════════\n";
    cardapio.lanches.forEach(item => {
        msg += `🔹 *${item.id}* ${item.nome} - R$ ${item.preco.toFixed(2).replace('.', ',')}\n`;
    });

    msg += "\n══════════════════════════\n";
    msg += "🥤 *BEBIDAS*\n";
    msg += "══════════════════════════\n";
    cardapio.bebidas.forEach(item => {
        msg += `🔹 *${item.id}* ${item.nome} - R$ ${item.preco.toFixed(2).replace('.', ',')}\n`;
    });

    msg += "\n══════════════════════════\n";
    msg += "🔢 Digite o *NÚMERO* do item desejado:";
    return msg;
}

function mostrarOpcoes() {
    return "✨ *O QUE DESEJA FAZER?* ✨\n\n" +
           "══════════════════════════\n" +
           "1️⃣  Adicionar mais itens\n" +
           "2️⃣  Finalizar compra\n" +
           "3️⃣  Cancelar pedido\n" +
           "4️⃣  Falar com atendente\n" +
           "5️⃣  📄 Ver Cardápio (PDF)\n" +
           "══════════════════════════\n" +
           "🔢 Digite o número da opção:";
}

client.on('qr', qr => qrcode.generate(qr, {small: true}));
client.on('ready', () => console.log('🤖 Bot pronto e operacional!'));

client.on('message', async message => {
    const text = message.body.trim();
    const sender = message.from;
    const agora = Date.now();

    if (!carrinhos[sender]) {
        carrinhos[sender] = { itens: [], estado: "inicio", ultimoEnvioPdf: 0, atendenteTimer: null };
    }

    if (carrinhos[sender].atendenteTimer && (agora - carrinhos[sender].atendenteTimer < 600000)) {
        return;
    } else if (carrinhos[sender].atendenteTimer) {
        carrinhos[sender].atendenteTimer = null;
        carrinhos[sender].estado = "opcoes";
        await client.sendMessage(sender, "⏳ *O período de atendimento humano terminou*\nComo posso ajudar?");
        await client.sendMessage(sender, mostrarOpcoes());
        return;
    }

    if (text.toLowerCase() === 'cliente') {
        carrinhos[sender] = { itens: [], estado: "escolhendo", ultimoEnvioPdf: carrinhos[sender]?.ultimoEnvioPdf || 0, atendenteTimer: null };
        await client.sendMessage(sender, "🔄 *Reiniciando seu pedido...*");
        await client.sendMessage(sender, mostrarCardapio());
        return;
    }

    if (carrinhos[sender].estado === "inicio" || carrinhos[sender].estado === "pos_compra") {
        carrinhos[sender].estado = "opcoes";
        await client.sendMessage(sender, "👋 *Bem-vindo ao Smash Burger!*");
        await client.sendMessage(sender, mostrarOpcoes());
        return;
    }

    if (text === '5' || text.toLowerCase().includes('cardapio')) {
        if (fs.existsSync(PDF_PATH)) {
            const media = MessageMedia.fromFilePath(PDF_PATH);
            await client.sendMessage(sender, media, { caption: '📄 *Cardápio Completo Smash Burger!*' });
            carrinhos[sender].ultimoEnvioPdf = agora;
        } else {
            await client.sendMessage(sender, "⚠️ *Cardápio temporariamente indisponível.*");
        }
        
        if (carrinhos[sender].estado === "escolhendo") {
            await client.sendMessage(sender, mostrarCardapio());
        } else {
            await client.sendMessage(sender, mostrarOpcoes());
        }
        return;
    }

    if (carrinhos[sender].estado === "escolhendo") {
        const numeroItem = parseInt(text);
        const todosItens = [...cardapio.lanches, ...cardapio.bebidas];
        const itemSelecionado = todosItens.find(item => item.id === numeroItem);

        if (itemSelecionado) {
            carrinhos[sender].itens.push(itemSelecionado);
            carrinhos[sender].estado = "opcoes";
            await client.sendMessage(sender, 
                `✅ *${itemSelecionado.nome}* adicionado ao carrinho!\n` +
                `💰 Valor: R$ ${itemSelecionado.preco.toFixed(2).replace('.', ',')}\n\n` + 
                mostrarOpcoes()
            );
        } else {
            await client.sendMessage(sender, 
                "❌ *Item não encontrado!*\n\n" +
                "🔢 Por favor, digite apenas o número do item conforme o cardápio:"
            );
            await client.sendMessage(sender, mostrarCardapio());
        }
        return;
    }

    if (carrinhos[sender].estado === "opcoes") {
        switch (text) {
            case "1":
                carrinhos[sender].estado = "escolhendo";
                await client.sendMessage(sender, "📝 *Adicionando mais itens...*");
                await client.sendMessage(sender, mostrarCardapio());
                break;

            case "2":
                if (carrinhos[sender].itens.length === 0) {
                    await client.sendMessage(sender, "🛒 *Seu carrinho está vazio!*\nAdicione itens antes de finalizar.");
                    return;
                }
                carrinhos[sender].estado = "aguardando_endereco";
                await client.sendMessage(sender,
                    "🏠 *INFORME SEU ENDEREÇO*\n\n" +
                    "Por favor, envie:\n" +
                    "📍 Rua, Número\n" +
                    "🏘️ Bairro\n" +
                    "📌 Ponto de referência\n\n" +
                    "Exemplo:\n" +
                    "👉 Rua das Flores, 123\n" +
                    "👉 Centro\n" +
                    "👉 Próximo ao mercado"
                );
                break;

            case "3":
                carrinhos[sender] = { itens: [], estado: "inicio", ultimoEnvioPdf: carrinhos[sender].ultimoEnvioPdf, atendenteTimer: null };
                await client.sendMessage(sender, "🗑️ *Pedido cancelado com sucesso!*\nVolte sempre!");
                break;
                
            case "4":
                carrinhos[sender].atendenteTimer = Date.now();
                await client.sendMessage(sender,
                    "👨‍🍳 *ATENDENTE HUMANO ACIONADO!*\n\n" +
                    "Você será atendido por um de nossos especialistas em hambúrgueres!\n\n" +
                    "⏳ Tempo de atendimento: 10 minutos\n" +
                    "⏰ Após esse período, retornaremos ao modo automático"
                );
                break;

            default:
                await client.sendMessage(sender, 
                    "⚠️ *OPÇÃO INVÁLIDA!*\n\n" +
                    "Por favor, escolha uma das opções abaixo:"
                );
                await client.sendMessage(sender, mostrarOpcoes());
                break;
        }
        return;
    }

    if (carrinhos[sender].estado === "aguardando_endereco") {
        if (text.length < 10) {
            await client.sendMessage(sender, "📢 *Endereço incompleto!*\nPor favor, informe rua, número e bairro.");
            return;
        }
        carrinhos[sender].endereco = text;
        
        await client.sendMessage(sender,
            "💳 *FORMA DE PAGAMENTO* 💳\n\n" +
            "1. Dinheiro 💵\n" +
            "2. PIX 📱\n" +
            "3. Cartão 💳\n\n" +
            "🔢 Digite o número da opção:"
        );
        carrinhos[sender].estado = "escolhendo_pagamento";
        return;
    }

    if (carrinhos[sender].estado === "escolhendo_pagamento") {
        const formas = {
            "1": "1. Dinheiro 💵",
            "2": "2. PIX 📱",
            "3": "3. Cartão 💳"
        };

        if (formas[text]) {
            carrinhos[sender].formaPagamento = formas[text];

            if (text === "1") {
                carrinhos[sender].estado = "aguardando_troco";
                await client.sendMessage(sender, 
                    "💵 *Pagamento em dinheiro selecionado*\n\n" +
                    "🔄 Informe o valor para troco (ex: '50' ou 'não'):"
                );
            } else {
                await client.sendMessage(sender, 
                    gerarCupomFiscal(
                        carrinhos[sender].itens, 
                        carrinhos[sender].endereco, 
                        carrinhos[sender].formaPagamento
                    )
                );
                await confirmarPedido(sender);
                carrinhos[sender].estado = "pos_compra";
            }
        } else {
            await client.sendMessage(sender, "❌ Opção inválida. Digite 1, 2 ou 3.");
        }
        return;
    }

    if (carrinhos[sender].estado === "aguardando_troco") {
        carrinhos[sender].troco = text;
        await client.sendMessage(sender, 
            gerarCupomFiscal(
                carrinhos[sender].itens, 
                carrinhos[sender].endereco, 
                carrinhos[sender].formaPagamento,
                text
            )
        );
        await confirmarPedido(sender);
        carrinhos[sender].estado = "pos_compra";
    }
});

async function confirmarPedido(sender) {
    await client.sendMessage(sender,
        "🎉 *PEDIDO CONFIRMADO!* 🎉\n\n" +
        "👨‍🍳 *Seu hambúrguer está sendo preparado com amor!*\n\n" +
        "⏱ *Tempo estimado:* 40-50 minutos\n" +
        "📱 *Acompanharemos seu pedido e avisaremos quando sair para entrega!*"
    );

    setTimeout(async () => {
        await client.sendMessage(sender, 
            "🛵 *SEU PEDIDO ESTÁ A CAMINHO!*\n\n" +
            "🔔 Deve chegar em instantes!\n" +
            "Se já recebeu, ignore esta mensagem."
        );
    }, 30 * 60 * 1000);
}

client.initialize();