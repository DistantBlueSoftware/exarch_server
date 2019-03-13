const express = require('express');
const colors = require('colors');
const router = express.Router();
const Card = require('./models/Card');
const _ = require('underscore');

const hypergeo = require('./hypergeo');

const cmcTable = [[18,.8],[19,1.12],[20,1.44],[21,1.76],[22,2.08],[23,2.4],[24,2.72],[25,3.04],[26,3.36],[27,3.68]]

const CardTypes = ['land', 'creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'planeswalker']
const ManaTypes = {B: '{B}', U: '{U}', R: '{R}', W: '{W}', G: '{G}', GW: '{G/W}', RW: '{R/W}', BR: '{B/R}', UW: '{W/U}', BW: '{W/B}', GU: '{G/U}', UR: '{U/R}', UB: '{U/B}', GR: '{R/G}', GB: '{B/G}', C: '{C}'}

const reservedWords = ['in','of', 'the', 'and', 'or', 'to', 'for', 'with']

const serverMessage = msg => {
  console.log(`${new Date()}: ${msg}`.underline.green)
}

const countManaSymbols = (cmc, color) => {
  if (color) {
    const search_term = new RegExp(ManaTypes[color], "g");    
    return cmc.match(search_term).length;
  } else {
    return cmc.match(/{.}/g).length;
  }
}

const cantripCalc = (deck) => {
  let answer = deck.noLands.filter(c => c.oracle_text.toLowerCase().includes('draw') && c.cmc < 2).reduce((a,c) => a+c.count, 0)
  
  if (answer) deck.adjustedCMC -= (answer * .75) / (deck.noLands.size - answer)
  return answer;
}

const accelCalc = (deck) => {
  let answer = deck.noLands.filter(c => c.name === 'Aether Vial' || c.oracle_text.toLowerCase().includes('{t}: add') || (c.oracle_text.toLowerCase().includes('search') && c.oracle_text.toLowerCase().includes('land')) && c.cmc <= 2).reduce((a,c) => a+c.count, 0)
  if (answer) deck.adjustedCMC -= ((answer * .5) / ((deck.noLands.size - answer) || deck.noLands.size)).toFixed(2);
  return answer;
}

const formatString = str => {
  return str.split('_').map(word => ~reservedWords.indexOf(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

const calcSourcesByColor = (num, size) => {
  for (let i = 0; i < 99; i++) {
    if (openingHandCalc(size, i, 7, 1) > .89) {
      return i;
    }
  }
}

const manaSourceCalc = deck => {
  const answer = {};
  _.each(deck.cmcDistribution[0], (num, key) => {
    if (key !== 'cmc' && num) answer[key] = calcSourcesByColor(num, deck.size) 
  })
  return answer;
}

const landCalc = deck => {
  return cmcTable.find(cmc => cmc[1] >= deck.adjustedCMC) ? cmcTable.find(cmc => cmc[1] >= deck.adjustedCMC)[0] : 0
}

const openingHandCalc = (deckSize, successPool, openingHand, numOfSuccesses) => {
  let answer = 0;
  for (let i = numOfSuccesses; i < openingHand; i++) {
    answer += hypergeo.pmf(deckSize, successPool, openingHand, i)
  }
  return answer;
}

const cmcDistCalc = (deck) => {
  const result = [];
  const CMCs = _.chain(deck)
    .sortBy('cmc')
    .map('cmc')
	  .uniq()
    .value();
    
  CMCs.forEach((cmc, index) => {
    result.push({cmc})
    Object.keys(ManaTypes).forEach(color => {
      let count;
      if (color === 'C') count = deck.filter(d => d.cmc === cmc && !d.colors.length).reduce((a,c) => a + c.count, 0)
      else count = deck.filter(d => d.cmc === cmc && hasColorIdentity(d.colors, color)).reduce((a,c) => a + c.count, 0)
      if (count) result[index][color] = count;
    })
  }) 
  return result;
}

const hasColorIdentity = (colorsArray, checkColor) => {
  return ~colorsArray.indexOf(checkColor)
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
  const deckData = {};
  deckData.notFound = [];
  Card.find({name: {$in: cardNames}})
  .then(cards => {
    list.forEach(l => {
      const card = cards.find(c => c.name == formatString(l.card));
      if (card) {
        card.count = l.count || 0;
        // adjust cmc for alternate casting cost (delve)
        card.adjCMC = card.oracle_text.includes('Delve') ? countManaSymbols(card.mana_cost) : card.cmc;
      }
      else deckData.notFound.push(formatString(l.card))
    })
    deckData.size = cards.map(c => c.count).reduce((c,t) => c+t, 0);
    deckData.noLands = cards.filter(c => !c.type_line.includes('Land'));
    deckData.noLands.size = deckData.noLands.map(c => c.count).reduce((a,c) => a+c, 0);
    deckData.avgCMC = (deckData.noLands.reduce((a, c) => a + (c.cmc * c.count), 0) / deckData.noLands.size).toFixed(2);
    deckData.adjustedCMC = (deckData.noLands.reduce((a, c) => a + (c.adjCMC * c.count), 0) / deckData.noLands.size).toFixed(2);
    deckData.counts = {};
    deckData.manaCosts = [];
    deckData.cmcDistribution = cmcDistCalc(deckData.noLands);
    deckData.cantripCount = cantripCalc(deckData);
    deckData.accelCount = accelCalc(deckData);
    CardTypes.forEach(type => {
      deckData.counts[type] = cards.filter(l => l.type_line.includes(type.charAt(0).toUpperCase() + type.slice(1))).map(c => c.count).reduce((a,c) => a+c, 0);
    });
    Object.keys(ManaTypes).forEach(key => {
      deckData.manaCosts.push({color: key, count:cards.filter(c => c.mana_cost.includes(ManaTypes[key])).map(c => c.count * countManaSymbols(c.mana_cost, key)).reduce((a, c) => a+c, 0)});
    });
    deckData.manaCosts.sort((a,b) => b.count - a.count);
    deckData.landRec = landCalc(deckData);
    deckData.manaSourceRec = manaSourceCalc(deckData);
    console.log(deckData.manaSourceRec)
    const completeTime = new Date();
    serverMessage(`deck analysis complete in ${completeTime - startTime}ms`)
    res.send({...deckData})
  })
  .catch(err => console.log(err))
  
})