const express = require('express');
const colors = require('colors');
const router = express.Router();
const Card = require('./models/Card');
const _ = require('underscore');

const CardTypes = ['land', 'creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'planeswalker']
const ManaTypes = {black: '{B}', blue: '{U}', red: '{R}', white: '{W}', green: '{G}', colorless: '{C}'}

const reservedWords = ['of', 'the', 'and', 'or', 'to']

const serverMessage = msg => {
  console.log(`${new Date()}: ${msg}`.underline.green)
}

const countManaSymbols = (cmc, color) => {
  return cmc.replace(/[{}]/g,'').split('').filter(l => l === ManaTypes[color]).length
}

const formatString = str => {
  return str.split('_').map(word => ~reservedWords.indexOf(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

module.exports = router;

router.get('/cards', (req, res, next) => {
  const startTime = new Date();
  serverMessage(`api GET request at path /cards`);
  return Card.find({})
  .then(cards => {
    const completeTime = new Date();
    res.json(cards)
    serverMessage(`request complete - ${cards.length} records sent in ${completeTime - startTime}ms`)
  })
  .catch(err => next(err));
})

router.get('/card/:name', (req, res, next) => {
  const cardName = formatString(req.params.name);
  console.log(cardName)
  return Card.findOne({name: cardName})
  .then(card => {
    res.json(card)
  })
  .catch(err => next(err));
})

router.post('/deck-analysis', (req, res, next) => {
  const startTime = new Date();
  const list = req.body;
  serverMessage(`deck analysis in progress...`)
  const cardNames = list.map(c => formatString(c.card));
  const notFound = [];
  Card.find({name: {$in: cardNames}})
  .then(cards => {
    list.forEach(l => {
      const card = cards.find(c => c.name == formatString(l.card));
      if (card) {
        card.count = l.count || 0;
        // adjust cmc for alternate casting cost (delve)
        card.adjCMC = card.oracle_text.includes('Delve') ? countManaSymbols(card.mana_cost) : card.cmc;
      }
      else notFound.push(formatString(l.card))
    })
    const size = cards.map(c => c.count).reduce((c,t) => c+t, 0);
    const noLands = cards.filter(c => !c.type_line.includes('Land'));
    const avgCMC = (noLands.reduce((a, c) => a + (c.cmc * c.count), 0) / noLands.map(c => c.count).reduce((a,c) => a+c, 0)).toFixed(2);
    const adjustedCMC = (noLands.reduce((a, c) => a + (c.adjCMC * c.count), 0) / noLands.map(c => c.count).reduce((a,c) => a+c, 0)).toFixed(2);
    const counts = {};
    const manaCosts = [];
    CardTypes.forEach(type => {
      counts[type] = cards.filter(l => l.type_line.includes(type.charAt(0).toUpperCase() + type.slice(1))).map(c => c.count).reduce((a,c) => a+c, 0);
    });
    Object.keys(ManaTypes).forEach(key => {
      manaCosts.push({color: key, count:cards.filter(c => c.mana_cost.includes(ManaTypes[key])).map(c => c.count * countManaSymbols(c.mana_cost, key)).reduce((a, c) => a+c, 0)});
    });
    manaCosts.sort((a,b) => b.count - a.count);
    const completeTime = new Date();
    serverMessage(`deck analysis complete in ${completeTime - startTime}ms`)
    res.send({size, counts, manaCosts, avgCMC, adjustedCMC, notFound})
  })
  .catch(err => console.log(err))
  
})