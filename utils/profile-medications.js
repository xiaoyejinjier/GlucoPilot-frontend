// Existing medication recording only; no dosage, defaults or treatment recommendations.
const GROUPS = [
  { label:'胰岛素（1型及部分2型使用）', names:['胰岛素（未注明种类）','门冬胰岛素','赖脯胰岛素','甘精胰岛素','德谷胰岛素','预混胰岛素'] },
  { label:'2型常见用药', names:['二甲双胍','阿卡波糖','格列齐特','格列美脲','西格列汀','达格列净','恩格列净','司美格鲁肽'] }
]
const NAMES = GROUPS.reduce((all,group)=>all.concat(group.names),[])
function parseMedication(text) {
  const selected=[],other=[]
  String(text||'').split(/[、，,；;\n]+/).map(value=>value.trim()).filter(Boolean).forEach(value=>{
    if(NAMES.includes(value)){if(!selected.includes(value))selected.push(value)}else other.push(value)
  })
  return { selected,other:other.join('；') }
}
function medicationGroups(selected=[]) {
  return GROUPS.map(group=>({label:group.label,options:group.names.map(name=>({name,selected:selected.includes(name)}))}))
}
function medicationText(selected,other) {
  return NAMES.filter(name=>selected.includes(name)).concat(String(other||'').trim()?[String(other).trim()]:[]).join('；')
}
module.exports={parseMedication,medicationGroups,medicationText,NAMES}
