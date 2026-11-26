/* Explainable rule matching from the supplied educational JSON.
 * Scores are weighted rule matches, never probabilities or diagnoses.
 */
(function attachCardioRuleMatcher(root){
  function ruleMatches(rule,value){
    if(value===null||value===undefined)return null;
    const target=rule.value;
    switch(rule.operator){
      case 'equals': return value===target;
      case 'not_equals': return value!==target;
      case 'in': return Array.isArray(target)&&target.includes(value);
      case 'between': return typeof value==='number'&&value>=target.min&&value<=target.max;
      case 'lt': return value<target;
      case 'lte': return value<=target;
      case 'gt': return value>target;
      case 'gte': return value>=target;
      case 'unmeasurable': return value==='unmeasurable';
      default: return null;
    }
  }

  function classify(pathologies,values){
    const candidates=[];
    for(const item of pathologies){
      let excluded=false,requiredMatched=0,requiredUnknown=0,supportHit=0,supportAvailable=0;
      const matched=[];
      for(const rule of item.classifier?.required||[]){
        const value=values[rule.feature];
        if(value===null||value===undefined){requiredUnknown++;continue;}
        if(ruleMatches(rule,value))requiredMatched++;else{excluded=true;break;}
      }
      if(excluded)continue;
      for(const rule of item.classifier?.supporting||[]){
        const value=values[rule.feature];
        if(value===null||value===undefined)continue;
        const weight=Number(rule.weight)||1;
        supportAvailable+=weight;
        if(ruleMatches(rule,value)){supportHit+=weight;matched.push(rule.feature);}
      }
      const conflicts=[];
      for(const rule of item.classifier?.conflicts||[]){
        const value=values[rule.feature];
        if(value!==null&&value!==undefined&&ruleMatches(rule,value)){conflicts.push(rule);}
      }
      if(excluded||conflicts.length||supportHit===0)continue;
      candidates.push({item,supportHit,supportAvailable,requiredMatched,requiredUnknown,matched,score:supportAvailable?supportHit/supportAvailable:0});
    }
    return candidates.sort((a,b)=>b.score-a.score||b.requiredMatched-a.requiredMatched||b.supportHit-a.supportHit);
  }

  root.CardioRuleMatcher={classify,ruleMatches};
})(globalThis);
