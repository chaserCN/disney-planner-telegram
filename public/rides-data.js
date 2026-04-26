(function(root, factory){
  const data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.RIDES_DATA = data;
})(typeof self !== "undefined" ? self : this, function(){
  const R = {
    "Big Thunder Mountain":       {id:25,t:"S",tp:"горки",p:"d",l:"Frontierland",bh:[9,10,20,21],ap:70,i:"⛰️",sr:0,pa:1},
    "Hyperspace Mountain":        {id:8,srid:7278,t:"S",tp:"горки",p:"d",l:"Discoveryland",bh:[9,10,21,22],ap:60,i:"🚀",sr:1,pa:1},
    "Frozen Ever After":          {id:15413,t:"S",tp:"сюжет лодки",p:"s",l:"World of Frozen",bh:[9,10,20],ap:80,i:"❄️",sr:0,pa:1},
    "Phantom Manor":              {id:26,t:"A",tp:"сюжет",p:"d",l:"Frontierland",bh:[9,10,12,13,20],ap:45,i:"👻",sr:0,pa:0},
    "Pirates of the Caribbean":   {id:3,t:"A",tp:"сюжет лодки",p:"d",l:"Adventureland",bh:[9,10,13,14,20],ap:40,i:"🏴‍☠️",sr:0,pa:1},
    "Indiana Jones":              {id:2,srid:7306,t:"A",tp:"горки",p:"d",l:"Adventureland",bh:[9,10,20,21],ap:50,i:"🏺",sr:1,pa:0},
    "Peter Pan's Flight":         {id:22,t:"A",tp:"сюжет",p:"d",l:"Fantasyland",bh:[9,21,22],ap:75,i:"🧚",sr:0,pa:1},
    "Snow White and the Seven Dwarfs": {id:15,t:"B",tp:"сюжет",p:"d",l:"Fantasyland",bh:[10,11,20],ap:30,i:"🍎",sr:0,pa:0},
    "Buzz Lightyear Laser Blast": {id:5,t:"B",tp:"интерактив",p:"d",l:"Discoveryland",bh:[9,10,13,20],ap:40,i:"🔫",sr:0,pa:1},
    "Star Tours":                 {id:9,t:"B",tp:"3D-полёт",p:"d",l:"Discoveryland",bh:[10,11,14,20],ap:30,i:"⭐",sr:0,pa:1},
    "It's a Small World":         {id:19,t:"C",tp:"сюжет лодки",p:"d",l:"Fantasyland",bh:[12,13,14,15],ap:20,i:"🌍",sr:0,pa:0},
    "Autopia":                    {id:4,t:"C",tp:"вождение",p:"d",l:"Discoveryland",bh:[10,11,19,20],ap:35,i:"🚗",sr:0,pa:1},
    "Orbitron":                   {id:7,t:"C",tp:"карусель",p:"d",l:"Discoveryland",bh:[10,11,20],ap:30,i:"🛸",sr:0,pa:1},
    "Crush's Coaster":            {id:32,srid:7277,t:"S",tp:"горки",p:"s",l:"World of Pixar",bh:[9,21],ap:90,i:"🐢",sr:1,pa:1},
    "Tower of Terror":            {id:40,t:"S",tp:"башня",p:"s",l:"Production Courtyard",bh:[9,10,20,21],ap:55,i:"🏚️",sr:1,pa:1},
    "Ratatouille":                {id:37,srid:7279,t:"S",tp:"сюжет",p:"s",l:"World of Pixar",bh:[9,10,21,22],ap:65,i:"🐀",sr:1,pa:1},
    "Avengers Assemble":          {id:10848,srid:10849,t:"A",tp:"горки",p:"s",l:"Avengers Campus",bh:[9,10,20,21],ap:50,i:"🦸",sr:1,pa:1},
    "RC Racer":                   {id:34,srid:7280,t:"B",tp:"горки",p:"s",l:"World of Pixar",bh:[10,11,19],ap:30,i:"🏁",sr:1,pa:0},
    "Spider-Man W.E.B.":          {id:10845,srid:10846,t:"B",tp:"интерактив",p:"s",l:"Avengers Campus",bh:[10,14,20],ap:35,i:"🕷️",sr:1,pa:0},
    "Toy Soldiers":               {id:35,srid:7281,t:"B",tp:"башня",p:"s",l:"World of Pixar",bh:[10,11,15,16],ap:25,i:"🪖",sr:1,pa:0},
    "Cars Road Trip":             {id:29,t:"C",tp:"прогулка",p:"s",l:"World of Pixar",bh:[10,11,14,15],ap:30,i:"🏎️",sr:0,pa:1},
  };

  return { R };
});
