// 19.11 TikChik WORLD IMPACT: where things are on the globe. Every place carries how it was found, so the page never shows
// an estimate as a verified fact:
//   hq      a company's headquarters: from FMP's profile of the company (its own address: city and country), from an
//           admin's correction (audited), or from the site's short list of well-known headquarters below ('list');
//   country the capital (or the financial centre, for a market) of a country the reading names;
//   region  a region's middle (the Middle East, Latin America...), for an event placed only by its region;
//   market  where a security is traded (New York, Tel Aviv...), for an index, a fund, or a share whose headquarters are
//           not known; said to be the exchange, not the company.
// The coordinates are of the city (about a kilometre): a globe needs no more.

// countries: [lat, lon, Hebrew name], the capital
export const CC={
  US:[38.91,-77.04,'ארה״ב'],IL:[31.77,35.21,'ישראל'],GB:[51.51,-0.13,'בריטניה'],CN:[39.90,116.40,'סין'],JP:[35.68,139.69,'יפן'],IN:[28.61,77.21,'הודו'],RU:[55.76,37.62,'רוסיה'],UA:[50.45,30.52,'אוקראינה'],
  DE:[52.52,13.40,'גרמניה'],FR:[48.86,2.35,'צרפת'],IT:[41.90,12.50,'איטליה'],ES:[40.42,-3.70,'ספרד'],NL:[52.37,4.90,'הולנד'],CH:[46.95,7.45,'שווייץ'],SE:[59.33,18.07,'שוודיה'],NO:[59.91,10.75,'נורווגיה'],
  DK:[55.68,12.57,'דנמרק'],FI:[60.17,24.94,'פינלנד'],IE:[53.35,-6.26,'אירלנד'],BE:[50.85,4.35,'בלגיה'],AT:[48.21,16.37,'אוסטריה'],PL:[52.23,21.01,'פולין'],CZ:[50.08,14.44,'צ׳כיה'],HU:[47.50,19.04,'הונגריה'],
  GR:[37.98,23.73,'יוון'],PT:[38.72,-9.14,'פורטוגל'],LU:[49.61,6.13,'לוקסמבורג'],CY:[35.19,33.38,'קפריסין'],TR:[39.93,32.86,'טורקיה'],RO:[44.43,26.10,'רומניה'],
  SA:[24.71,46.68,'ערב הסעודית'],AE:[24.45,54.38,'איחוד האמירויות'],QA:[25.29,51.53,'קטאר'],KW:[29.38,47.99,'כווית'],BH:[26.23,50.59,'בחריין'],OM:[23.59,58.41,'עומאן'],IR:[35.69,51.39,'איראן'],IQ:[33.31,44.36,'עיראק'],
  SY:[33.51,36.28,'סוריה'],LB:[33.89,35.50,'לבנון'],JO:[31.95,35.93,'ירדן'],EG:[30.04,31.24,'מצרים'],PS:[31.90,35.20,'הרשות הפלסטינית'],YE:[15.37,44.19,'תימן'],
  KR:[37.57,126.98,'דרום קוריאה'],KP:[39.04,125.76,'צפון קוריאה'],TW:[25.03,121.57,'טייוואן'],HK:[22.32,114.17,'הונג קונג'],SG:[1.35,103.82,'סינגפור'],AU:[-35.28,149.13,'אוסטרליה'],NZ:[-41.29,174.78,'ניו זילנד'],
  CA:[45.42,-75.70,'קנדה'],MX:[19.43,-99.13,'מקסיקו'],BR:[-15.79,-47.88,'ברזיל'],AR:[-34.60,-58.38,'ארגנטינה'],CL:[-33.45,-70.67,'צ׳ילה'],CO:[4.71,-74.07,'קולומביה'],VE:[10.48,-66.90,'ונצואלה'],PE:[-12.05,-77.04,'פרו'],
  PA:[8.98,-79.52,'פנמה'],ZA:[-25.75,28.19,'דרום אפריקה'],NG:[9.08,7.40,'ניגריה'],KE:[-1.29,36.82,'קניה'],ET:[9.03,38.74,'אתיופיה'],MA:[34.02,-6.83,'מרוקו'],DZ:[36.75,3.06,'אלג׳יריה'],LY:[32.89,13.19,'לוב'],
  ID:[-6.21,106.85,'אינדונזיה'],MY:[3.14,101.69,'מלזיה'],TH:[13.76,100.50,'תאילנד'],VN:[21.03,105.85,'וייטנאם'],PH:[14.60,120.98,'הפיליפינים'],PK:[33.68,73.05,'פקיסטן'],BD:[23.81,90.41,'בנגלדש'],
  KZ:[51.17,71.45,'קזחסטן'],AF:[34.56,69.21,'אפגניסטן'],UY:[-34.90,-56.16,'אורוגוואי'],SD:[15.50,32.56,'סודן'],BY:[53.90,27.56,'בלארוס'],RS:[44.79,20.45,'סרביה'],
  EU:[50.85,4.35,'האיחוד האירופי']};
// a market's financial centre, where it differs from the capital
export const FIN={US:[40.71,-74.01,'ניו יורק'],IL:[32.08,34.78,'תל אביב'],CN:[31.23,121.47,'שנגחאי'],DE:[50.11,8.68,'פרנקפורט'],CH:[47.38,8.54,'ציריך'],IN:[19.08,72.88,'מומבאי'],
  CA:[43.65,-79.38,'טורונטו'],AU:[-33.87,151.21,'סידני'],BR:[-23.55,-46.63,'סאו פאולו'],TR:[41.01,28.98,'איסטנבול'],AE:[25.20,55.27,'דובאי'],SA:[24.71,46.68,'ריאד'],EU:[50.11,8.68,'פרנקפורט']};
// the readings' regions (server/newsx.js REGIONS): a country where the region is one, else the region's middle
export const REG_CC={us:'US',israel:'IL',uk:'GB',china:'CN',japan:'JP',india:'IN',russia:'RU',ukraine:'UA',europe:'EU'};
export const REGION_PT={middle_east:[29.0,44.0,'המזרח התיכון'],latam:[-12.0,-60.0,'אמריקה הלטינית'],asia:[25.0,105.0,'אסיה'],europe:[50.85,4.35,'אירופה']};

// cities (lower case, as a profile writes them), for a headquarters' address
export const CITY={
  'cupertino':[37.32,-122.03],'redmond':[47.67,-122.12],'santa clara':[37.35,-121.96],'mountain view':[37.39,-122.08],'seattle':[47.61,-122.33],'menlo park':[37.45,-122.18],'austin':[30.27,-97.74],
  'palo alto':[37.44,-122.14],'san jose':[37.34,-121.89],'san francisco':[37.77,-122.42],'sunnyvale':[37.37,-122.04],'los gatos':[37.24,-121.96],'los angeles':[34.05,-118.24],'san diego':[32.72,-117.16],
  'irvine':[33.68,-117.83],'burbank':[34.18,-118.31],'fremont':[37.55,-121.99],'milpitas':[37.43,-121.90],'foster city':[37.56,-122.27],'south san francisco':[37.65,-122.41],'thousand oaks':[34.17,-118.84],
  'oakland':[37.80,-122.27],'new york':[40.71,-74.01],'armonk':[41.13,-73.71],'purchase':[41.04,-73.71,'NY'],'boston':[42.36,-71.06],'cambridge':[42.37,-71.11,'MA'],'waltham':[42.38,-71.24],
  'chicago':[41.88,-87.63],'abbott park':[42.30,-87.89],'north chicago':[42.33,-87.84],'deerfield':[42.17,-87.84],'moline':[41.51,-90.52],'atlanta':[33.75,-84.39],'dallas':[32.78,-96.80],'houston':[29.76,-95.37],
  'spring':[30.08,-95.42,'TX'],'irving':[32.81,-96.95],'plano':[33.02,-96.70],'round rock':[30.51,-97.68],'westlake':[32.99,-97.20,'TX'],'san antonio':[29.42,-98.49],'bentonville':[36.37,-94.21],'indianapolis':[39.77,-86.16],
  'omaha':[41.26,-95.94],'charlotte':[35.23,-80.84],'mooresville':[35.58,-80.81],'minneapolis':[44.98,-93.27],'minnetonka':[44.91,-93.50],'detroit':[42.33,-83.05],'dearborn':[42.32,-83.18],'phoenix':[33.45,-112.07],
  'boise':[43.62,-116.20],'denver':[39.74,-104.99],'washington':[38.91,-77.04,'DC'],'arlington':[38.88,-77.10,'VA'],'reston':[38.96,-77.36],'bethesda':[38.98,-77.10],'falls church':[38.88,-77.17],'baltimore':[39.29,-76.61],
  'philadelphia':[39.95,-75.17],'pittsburgh':[40.44,-80.00],'new brunswick':[40.49,-74.45],'rahway':[40.61,-74.28],'princeton':[40.36,-74.67],'parsippany':[40.86,-74.43],'stamford':[41.05,-73.54],'norwalk':[41.12,-73.41],
  'miami':[25.76,-80.19],'juno beach':[26.88,-80.05],'nashville':[36.16,-86.78],'cincinnati':[39.10,-84.51],'columbus':[39.96,-83.00,'OH'],'findlay':[41.04,-83.65],'memphis':[35.15,-90.05],'issaquah':[47.53,-122.03],
  'bellevue':[47.61,-122.20],'beaverton':[45.49,-122.80],'portland':[45.52,-122.68,'OR'],'reno':[39.53,-119.81],'salt lake city':[40.76,-111.89],'las vegas':[36.17,-115.14],
  'tel aviv':[32.08,34.78],'tel aviv-yafo':[32.08,34.78],'petah tikva':[32.09,34.88],'petach tikva':[32.09,34.88],'herzliya':[32.16,34.84],'haifa':[32.79,34.99],'jerusalem':[31.77,35.21],"ra'anana":[32.18,34.87],
  'raanana':[32.18,34.87],'rehovot':[31.89,34.81],'yokneam':[32.66,35.11],'yokneam illit':[32.66,35.11],'migdal haemek':[32.68,35.24],'rosh haayin':[32.10,34.96],'airport city':[32.00,34.88],
  'hsinchu':[24.80,120.97],'taipei':[25.03,121.57],'seoul':[37.57,126.98],'suwon':[37.26,127.03],'tokyo':[35.68,139.69],'osaka':[34.69,135.50],'kyoto':[35.01,135.77],'toyota':[35.08,137.16],'toyota city':[35.08,137.16],
  'beijing':[39.90,116.40],'shanghai':[31.23,121.47],'shenzhen':[22.54,114.06],'hangzhou':[30.27,120.16],'hong kong':[22.32,114.17],'singapore':[1.35,103.82],'london':[51.51,-0.13],'cambridge uk':[52.21,0.12],
  'amsterdam':[52.37,4.90],'veldhoven':[51.42,5.40],'eindhoven':[51.44,5.47],'walldorf':[49.31,8.64],'munich':[48.14,11.58],'stuttgart':[48.78,9.18],'frankfurt':[50.11,8.68],'paris':[48.86,2.35],'courbevoie':[48.90,2.26],
  'basel':[47.56,7.59],'vevey':[46.46,6.84],'zurich':[47.38,8.54],'copenhagen':[55.68,12.57],'bagsvaerd':[55.76,12.45],'stockholm':[59.33,18.07],'oslo':[59.91,10.75],'dublin':[53.35,-6.26],'toronto':[43.65,-79.38],
  'vancouver':[49.28,-123.12],'montreal':[45.50,-73.57],'ottawa':[45.42,-75.70],'calgary':[51.05,-114.07],'sydney':[-33.87,151.21],'melbourne':[-37.81,144.96],'sao paulo':[-23.55,-46.63],'rio de janeiro':[-22.91,-43.17],
  'mexico city':[19.43,-99.13],'mumbai':[19.08,72.88],'bengaluru':[12.97,77.59],'bangalore':[12.97,77.59],'riyadh':[24.71,46.68],'dhahran':[26.29,50.11],'dubai':[25.20,55.27],'abu dhabi':[24.45,54.38]};
// the headquarters of well-known companies (city key, country), checked by hand; FMP's profile and an admin's correction
// come first. A company not here and without a profile is placed at its exchange, and said to be
export const HQ_LIST={
  AAPL:['cupertino','US'],MSFT:['redmond','US'],NVDA:['santa clara','US'],GOOGL:['mountain view','US'],GOOG:['mountain view','US'],AMZN:['seattle','US'],META:['menlo park','US'],TSLA:['austin','US'],
  AVGO:['palo alto','US'],JPM:['new york','US'],LLY:['indianapolis','US'],XOM:['spring','US'],TSM:['hsinchu','TW'],TEVA:['tel aviv','IL'],CHKP:['tel aviv','IL'],'BRK.B':['omaha','US'],'BRK-B':['omaha','US'],
  V:['san francisco','US'],MA:['purchase','US'],UNH:['minnetonka','US'],JNJ:['new brunswick','US'],WMT:['bentonville','US'],PG:['cincinnati','US'],HD:['atlanta','US'],COST:['issaquah','US'],BAC:['charlotte','US'],
  KO:['atlanta','US'],PEP:['purchase','US'],ABBV:['north chicago','US'],MRK:['rahway','US'],ADBE:['san jose','US'],CRM:['san francisco','US'],NFLX:['los gatos','US'],AMD:['santa clara','US'],INTC:['santa clara','US'],
  QCOM:['san diego','US'],TXN:['dallas','US'],CSCO:['san jose','US'],IBM:['armonk','US'],DIS:['burbank','US'],NKE:['beaverton','US'],MCD:['chicago','US'],WFC:['san francisco','US'],GS:['new york','US'],MS:['new york','US'],
  C:['new york','US'],BA:['arlington','US'],LMT:['bethesda','US'],RTX:['arlington','US'],NOC:['falls church','US'],GD:['reston','US'],CAT:['irving','US'],DE:['moline','US'],HON:['charlotte','US'],UPS:['atlanta','US'],
  FDX:['memphis','US'],T:['dallas','US'],VZ:['new york','US'],TMUS:['bellevue','US'],PFE:['new york','US'],AMGN:['thousand oaks','US'],GILD:['foster city','US'],ABT:['abbott park','US'],TMO:['waltham','US'],
  MU:['boise','US'],AMAT:['santa clara','US'],LRCX:['fremont','US'],KLAC:['milpitas','US'],ASML:['veldhoven','NL'],ARM:['cambridge uk','GB'],PLTR:['denver','US'],UBER:['san francisco','US'],ABNB:['san francisco','US'],
  PYPL:['san jose','US'],CRWD:['austin','US'],PANW:['santa clara','US'],NOW:['santa clara','US'],INTU:['mountain view','US'],ISRG:['sunnyvale','US'],BKNG:['norwalk','US'],SBUX:['seattle','US'],LOW:['mooresville','US'],
  TGT:['minneapolis','US'],CMCSA:['philadelphia','US'],SCHW:['westlake','US'],BLK:['new york','US'],SPGI:['new york','US'],AXP:['new york','US'],GM:['detroit','US'],F:['dearborn','US'],RIVN:['irvine','US'],
  NIO:['shanghai','CN'],BABA:['hangzhou','CN'],JD:['beijing','CN'],BIDU:['beijing','CN'],SONY:['tokyo','JP'],TM:['toyota city','JP'],SAP:['walldorf','DE'],NVO:['bagsvaerd','DK'],SHEL:['london','GB'],BP:['london','GB'],
  TTE:['courbevoie','FR'],AZN:['cambridge uk','GB'],HSBC:['london','GB'],GSK:['london','GB'],SNY:['paris','FR'],NVS:['basel','CH'],RIO:['london','GB'],BHP:['melbourne','AU'],VALE:['rio de janeiro','BR'],PBR:['rio de janeiro','BR'],
  NICE:['raanana','IL'],WIX:['tel aviv','IL'],MNDY:['tel aviv','IL'],CYBR:['petah tikva','IL'],ESLT:['haifa','IL'],TSEM:['migdal haemek','IL'],SEDG:['herzliya','IL'],ICL:['tel aviv','IL'],NVMI:['rehovot','IL'],
  CAMT:['migdal haemek','IL'],FVRR:['tel aviv','IL'],INMD:['yokneam','IL'],RDWR:['tel aviv','IL'],ZIM:['haifa','IL'],SMCI:['san jose','US'],DELL:['round rock','US'],HPQ:['palo alto','US'],
  CEG:['baltimore','US'],NEE:['juno beach','US'],DUK:['charlotte','US'],SO:['atlanta','US'],VST:['irving','US'],OXY:['houston','US'],COP:['houston','US'],SLB:['houston','US'],HAL:['houston','US'],KMI:['houston','US'],
  EOG:['houston','US'],MPC:['findlay','US'],PSX:['houston','US'],VLO:['san antonio','US'],NEM:['denver','US'],FCX:['phoenix','US']};
// where an index, a fund or an exchange sits: New York for the American market, Tel Aviv for the Israeli one
export const MARKET_PT={US:[40.707,-74.011,'הבורסה בניו יורק'],IL:[32.064,34.770,'הבורסה בתל אביב'],GB:[51.515,-0.099,'הבורסה בלונדון'],DE:[50.115,8.674,'הבורסה בפרנקפורט'],JP:[35.682,139.777,'הבורסה בטוקיו'],
  HK:[22.284,114.158,'הבורסה בהונג קונג'],CN:[31.234,121.506,'הבורסה בשנגחאי'],CA:[43.648,-79.384,'הבורסה בטורונטו']};
export const INDEX_MKT={SPX:'US',NDX:'US',DJI:'US',RUT:'US',VIX:'US',TA35:'IL',TA125:'IL',TA90:'IL'};
const P=(lat,lon,name,how,src,extra={})=>({lat:Math.round(lat*1000)/1000,lon:Math.round(lon*1000)/1000,name,how,src,...extra});
export const countryPt=(cc,{market=false}={})=>{const c=CC[cc]; if(!c)return null; const f=market&&FIN[cc]; return f?P(f[0],f[1],f[2],'country','gaz',{cc}):P(c[0],c[1],c[2],'country','gaz',{cc})};
export const regionPt=r=>{const c=REG_CC[r]; if(c&&c!=='EU')return countryPt(c); const g=REGION_PT[r]; return g?P(g[0],g[1],g[2],'region','gaz',{region:r}):null};
export const marketPt=cc=>{const m=MARKET_PT[cc]; return m?P(m[0],m[1],m[2],'market','gaz',{cc}):null};
const norm=s=>String(s||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ');
// a city from a profile ("Santa Clara", "Tel Aviv-Yafo"), with the country it should be in (a London that is not in GB is
// not London, England); null when the city is not in the list
export function cityPt(city,cc,state){let k=norm(city).replace(/-yafo$/,'').replace(/,.*$/,'').trim(); if(k==='cambridge'&&cc==='GB')k='cambridge uk';
  const c=CITY[k]; if(!c)return null; if(c[2]&&(cc&&cc!=='US'||state&&String(state).toUpperCase().slice(0,2)!==c[2]))return null;   // a Cambridge that is not in MA, an Arlington that is not in VA
  return P(c[0],c[1],city,'hq','fmp',{cc:cc||null})}
// a company's headquarters: the admin's correction, then FMP's profile (city, else its country), then the list; null when
// none of them knows it (the caller then places it at its exchange, said to be so)
export function hqOf(sym,{fix=null,about=null}={}){
  const f=fix&&fix[sym]; if(f&&Number.isFinite(+f.lat)&&Number.isFinite(+f.lon))return P(+f.lat,+f.lon,String(f.name||sym).slice(0,60),'hq','fix',{by:f.by||null,at:f.at||null});
  if(about&&(about.city||about.country)){const cc=String(about.country||'').toUpperCase(); const c=about.city?cityPt(about.city,cc,about.state):null; if(c)return c;
    if(CC[cc])return {...countryPt(cc),how:'country',src:'fmp',note:'הפרופיל נותן את המדינה בלבד'}}
  const L=HQ_LIST[sym]; if(L){const c=CITY[L[0]]; if(c)return P(c[0],c[1],L[0].replace(/\b\w/g,m=>m.toUpperCase()).replace(' Uk',''),'hq','list',{cc:L[1]})}
  return null;
}
export const CC_HE=Object.fromEntries(Object.entries(CC).map(([k,v])=>[k,v[2]]));
