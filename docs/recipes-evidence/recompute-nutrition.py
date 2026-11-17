import json
from pathlib import Path
base=Path(__file__).resolve().parent
usda=json.loads((base/'usda-selected.json').read_text()); foods=usda['foods']
fields=['kcal','protein_g','carbs_g','fiber_g']
def label(key,name,grams,kcal,protein,carbs,fiber,fat,source,note=''):
 foods[key]={'description':name,'basis':f'Manufacturer label per {grams}g; scaled to per100g','source':source,'assumption':note,**{k:v*100/grams for k,v in zip(fields,[kcal,protein,carbs,fiber])}}
label('yeast','Bob\'s Red Mill nutritional yeast',8,30,4,3,2,0,'https://www.bobsredmill.com/product/nutritional-yeast')
label('harissa','Mina mild harissa',15,10,0,1,0,0.5,'https://mina.co/products/mina-harissa-mild','All 60g used is included. Fat not modeled or reported; no inferred fat label values.')
label('salsa','Herdez mild salsa verde',31,10,0,2,0,0,'https://www.salsas.com/herdez/products/salsas/salsa-verde/','Fiber not listed/significant: conservatively assume 0g. Full measured salsa is served after pressure cooking.')
label('gnocchi','DeLallo US potato gnocchi',140,230,6,50,2,0,'https://www.delallo.com/delallo-potato-gnocchi-16-oz/','Current manufacturer US label viewed by independent reviewer; wheat gnocchi, not gluten-free or refrigerated substitute.')
label('pesto_label','DeLallo basil pesto squeeze bottle',30,190,0,3,1,0,'https://www.delallo.com/pesto-squeeze-bottle/','Protein labeled<1g is modeled0 conservatively. Measured45g per batch. Label cup/tbsp equivalence is unusual, so use grams.')
# Feta/Parmesan/yogurt remain USDA generic. A substitute yogurt must provide >=9g protein/100g and <=4g total carbs/100g.
recipes={}
def add(key,title,group,items,veg,notes=''):
 rows=[];total={f:0 for f in fields}
 for food,grams in items:
  src=foods[food];n={f:src[f]*grams/100 for f in fields}
  rows.append({'food_key':food,'description':src['description'],'grams_batch':grams,'source':src['source'],'fdc_id':src.get('fdc_id'),'nutrients_batch':n})
  for f in fields:total[f]+=n[f]
 per={f:v/4 for f,v in total.items()};per['net_carbs_g']=per['carbs_g']-per['fiber_g']
 recipes[key]={'title':title,'group':group,'servings':4,'ingredients':rows,'per_serving':per,'vegetables_g_per_serving':veg/4,'notes':notes}
add('salmon','Lemon salmon and asparagus','keto',[('salmon',680),('asparagus',454),('olive_oil',27),('garlic_powder',3.1),('lemon_zest',2),('lemon_juice',30),('hemp',20)],454)
add('smoky_chicken','Smoky chicken thighs and broccoli','keto',[('chicken_thigh',680),('broccoli',454),('olive_oil',27),('paprika',2.3),('garlic_powder',3.1),('oregano',0.5),('lemon_juice',15),('yeast',8)],454)
add('cod','Pesto cod and zucchini','keto',[('cod',680),('zucchini',680),('pesto_label',45),('olive_oil',27),('lemon_juice',15),('hemp',20)],680,'Manufacturer squeeze-bottle pesto45g. Substitutes must supply <=2g net carbs per30g. All sauce/oil included.')
add('frittata','Spinach, feta, and hemp frittata','keto',[('egg',600),('spinach_frozen',454),('feta',75),('hemp',40),('yeast',8),('garlic_powder',1.55),('olive_oil',18),('lettuce',142),('lemon_juice',15)],596,'12 eggs at50g edible/egg. Spinach454g BEFORE thaw/drain; nutrient retention modeled100%, so drained losses make this an approximate estimate. Salad included.')
add('shawarma','Shawarma chicken bowls','family',[('chicken_thigh',680),('cauliflower',454),('olive_oil',27),('cumin',4.2),('paprika',2.3),('garlic_powder',3.1),('turmeric',1.5),('cinnamon',0.65),('yogurt2',120),('lemon_juice',30),('cucumber',150),('lettuce',142)],746)
add('fajitas','Sheet-pan chicken fajitas','family',[('chicken_thigh',680),('red_pepper',300),('onion',60),('olive_oil',27),('chili_powder',5.4),('cumin',2.1),('paprika',2.3),('garlic_powder',1.55),('lime_juice',30),('lettuce',142),('avocado',150),('yogurt2',60)],502,'Avocado is excluded from vegetable benchmark but included in macros.')
add('salsa_chicken','Salsa verde shredded chicken','family',[('chicken_thigh',680),('chicken_broth',375),('salsa',124),('cumin',2.1),('garlic_powder',1.55),('lime_juice',30),('cabbage',454),('avocado',150),('yogurt2',60)],454,'Conservatively counts ALL broth even though most is reserved, plus all salsa served. Pure cabbage slaw; carrot mix requires label recalculation.')
add('turkey','Greek turkey patties','family',[('turkey93',680),('egg',50),('flax',14),('feta',50),('oregano',1),('garlic_powder',3.1),('olive_oil',4.5),('cucumber',300),('lettuce',142),('yogurt2',120),('lemon_juice',15)],442)
add('lentil_bake','Tomato, lentil, and chicken bake','nonketo',[('cooked_chicken_breast',340),('lentils_cooked',480),('tomato_canned',411),('spinach_raw',142),('olive_oil',13.5),('paprika',2.3),('cumin',2.1),('garlic_powder',1.55),('oregano',0.5),('lemon_juice',15),('feta',60)],553,'Lentils are a cooked-boiled USDA proxy for drained canned lentils; brand and drained yield vary. Cooked breast340g not raw. Tomato liquid included in vegetable mass; spinach alone is35g/person.')
add('chickpea','Harissa chickpea and cauliflower bowls','nonketo',[('chickpeas_rinsed',480),('cauliflower',680),('olive_oil',27),('harissa',60),('cumin',2.1),('garlic_powder',1.55),('yogurt2',600),('lemon_juice',30),('hemp',20),('lettuce',142)],822,'Mandatory strained Greek yogurt600g. Protein threshold additionally tested at yogurt9g/100g. Harissa60g, split between roast and yogurt; not a variable range.')
add('potato_chicken','Lemon chicken, potatoes, and green beans','nonketo',[('chicken_thigh',680),('potato',567),('green_beans',454),('olive_oil',27),('oregano',1),('garlic_powder',3.1),('lemon_zest',2),('lemon_juice',30),('yeast',8)],454,'Potatoes raw edible weight; pre-microwaved at home during oven preheat, not a purchased precooked product.')
add('gnocchi','Sheet-pan gnocchi, white beans, and broccoli','nonketo',[('gnocchi',454),('white_beans_canned',480),('broccoli',454),('tomato_raw',300),('olive_oil',40.5),('oregano',1),('garlic_powder',1.55),('yeast',4),('lemon_juice',15),('hemp',20),('parmesan',100)],754,'USDA canned-white-bean proxy has no explicit drained-state qualifier: intentional conservative approximation, also checked against boiled white beans. All beans added at midpoint to reduce drying. Grated Parmesan100g mandatory, yeast4g only.')
# Plain cooked starch reference portions, not claims about branded microwave rice.
addons={}
for key,food,grams in [('rice_half_cup','rice_cooked',80),('pita_one','pita',60),('corn_tortillas_two','corn_tortilla',50),('bun_one','bun',45)]:
 per={f:foods[food][f]*grams/100 for f in fields};per['net_carbs_g']=per['carbs_g']-per['fiber_g'];addons[key]={'food_key':food,'grams':grams,'nutrients':per,'source':foods[food]['source']}
# Bounds for substitutes stated in article, and vegetable mass independent of water loss.
bounds={}
for key,r in recipes.items():
 bounds[key]={'protein_pass':r['per_serving']['protein_g']>=25,'vegetable_pass':r['vegetables_g_per_serving']>=100,'keto_pass':r['group']=='nonketo' or r['per_serving']['net_carbs_g']<=10}
print('BASELINE FINAL-DESIGN MODEL')
for key,r in recipes.items():
 p=r['per_serving'];print(key, 'kcal',round(p['kcal']),'protein',round(p['protein_g'],1),'carbs',round(p['carbs_g'],1),'fiber',round(p['fiber_g'],1),'net',round(p['net_carbs_g'],1),'veg',round(r['vegetables_g_per_serving']),bounds[key])
result={'method':'Sum per100g nutrient*edible ingredient grams/100, divide batch by4. US total carb minus dietary fiber for net carbs. No sugar alcohol subtraction. No cooking-yield scaling of raw meat. All specified oil, acid, sauces, seeds, yeast and salad included. Black pepper to taste and salt excluded from five macros; sodium not reported. Values are estimates, not lab results.', 'usda_archive':{k:v for k,v in usda.items() if k!='foods'},'foods':foods,'recipes':recipes,'addons':addons,'checks':bounds,'uncertainty':'Food composition and label rounding vary. Generic chicken thigh is lean trimmed USDA meat and may understate fattier products. Oil retained100%; broth retained100% conservatively. No micronutrient-retention claim. Vegetable mass is edible ingredient weight before cooking/draining spinach, not cooked plate weight. Raw meat and cooked meat records are never swapped.'}
(base/'nutrition-calculations.json').write_text(json.dumps(result,indent=2)+'\n')
assert all(all(c.values()) for c in bounds.values()), 'A recipe failed the numeric design bar'
