const NormalSdk = require("@normalframework/applications-sdk");

const xlsx = require('node-xlsx');
const fs = require("fs")
const { v5: uuidv5 } = require("uuid");

const simulationTypes = {
  "IAQ Monitor": {
    name: "IAQ Monitor",
    className: "iaqSensor",
    id: "a79ee918-6165-11ef-8543-3f99d1ab9c4e",
    description: "A device which measures IAQ parameters",
    markers: [{
      name: "iaqSensor  "
    }, {
      name: "equip"
    }, {
      name: "sim" 
    }
    ],
    points: [],
    attributes: [],
    relations: [
      {
        name: "spaceRef"
      }
    ],
    instances: {
      id1: {
        points: {
          name1: {

          }
        }
      }
    }

  },
  "Utility Meter": {
    name: "Utility Meter",
    className: "meter",
    id: "58e9ddf6-61b4-11ef-aeae-3784d041d9e5",
    markers: [{ name: "sim" },
     {name: "meter"},
      {name: "equip"}
    ],
    points: [],
    attributes: [],
  }
}
 
/**
 * Invoke hook function
 * @param {NormalSdk.InvokeParams} params
 * @returns {NormalSdk.InvokeResult}
 */
module.exports = async ({points, sdk, update, args}) => {


  const workSheetsFromBuffer = xlsx.parse(fs.readFileSync("OCDA_Sim_Operations_071624.xlsx"));
  const arr = workSheetsFromBuffer[0].data;
  var equipRef = []
  for (var i = 0; i < 20; i++) {
    console.log(arr[i][0])
    if (arr[i][0] == "Equipment Reference") {
      equipRef = arr[i]
    } 
  }
  var equipmentTypes = new Set()
  for (var i = 2; i < equipRef.length; i++) {
    equipmentTypes.add(equipRef[i])
  }
  // find the equipment types we need to create
  console.log(equipRef)
  console.log(equipmentTypes)
  // create the equipment types
  equipmentTypes.forEach(async t => {
    await sdk.http.post("/api/v1/equipment/types",{
      equipmentType: simulationTypes[t]}).catch(handleAlreadyExistsResponse);
  })

  // build the points attrs list
  points = []
  for (var i = 0; i < 20; i++) {
    if (!arr[i][0]) {
      break
    }
    var fieldname = camelize(arr[i][0])
    console.log(fieldname)
    for (var j = 2; j < arr[i].length; j++ ) {
      if (!points[j-2]) {
        points[j-2] = {
          //name: arr[i][j],
          layer: "auros",
          point_type: "POINT",
          dataLayer: "auros",
          attrs: {
            columnIndex: String(j),
            importTime: String(new Date()),
          },
        }
      }
      points[j-2].attrs[fieldname] = String(arr[i][j])
    }
  }

  var equips = []
  var models = []

  // give the points names, uuids, and model fields
  for (var i = 0; i < points.length; i++) {
    const attrs = points[i].attrs
    points[i].name = attrs.projectName + "." + attrs.equipmentReference + "." + attrs.zone + "." + attrs.uOM
    points[i].uuid = uuidv5(points[i].name, simulationTypes[attrs.equipmentReference].id)
    points[i].name = attrs.uOM

    real_units = attrs.uOM.match(/\((.*)\)/)[1]
    console.log(points[i])

    const equipType = points[i].attrs.equipmentReference
    const equipRef = points[i].attrs.zone
    models.push({
      uuid: points[i].uuid,
      layer: "model",
      parentName: equipRef,
      displayUnits: real_units,
      attrs: {
        equipRef: equipRef,
        equipTypeId: simulationTypes[equipType].id,
      }
    })

    equips.push({
      uuid: uuidv5(equipType + equipRef, simulationTypes[equipType].id),
      layer: "model",
      name: equipRef,
      pointType: 4,
      attrs: {
        id: equipRef,
        markers: markers(simulationTypes[equipType].markers),
        type: simulationTypes[equipType].name,
        equipTypeId: simulationTypes[equipType].id,
        class: simulationTypes[equipType].className,
      }
    })
  }
  //console.log(equips)

  await sdk.http.post("/api/v1/point/points",{
      points: points}).catch(handleAlreadyExistsResponse);

  await sdk.http.post("/api/v1/point/points",{
      points: models}).catch(handleAlreadyExistsResponse);

  await sdk.http.post("/api/v1/point/points",{
      points: equips}).catch(handleAlreadyExistsResponse);

  // add the equipment model instances 

  let started = false
  var date = undefined

  data = { }
  for (let i = 0; i < points.length; i++) {
    data[points[i].uuid] = {
      uuid: points[i].uuid,
      isAsync: true,
      values: [],
    }
  }

  for (let i = 0; i < arr.length; i++) {
    console.log(date)
    // track the last value in the date column
    if (arr[i][0] == "Date") {
      started = true
      continue
    } 
    if (!started) {
      continue
    } else if (arr[i][0]) {
      date = arr[i][0]
      console.log(date)
    }

    const time = arr[i][1]
    for (let j = 0; j < points.length; j++) {
      const colIndex = parseInt(points[j].attrs.columnIndex)
      const ts = makeDate(points[j].attrs.simulationCalendarYear, date, time)
      const val = arr[i][colIndex]
      data[points[j].uuid].values.push({
        ts:ts.toISOString(),
        real: val,
      })
    }
  }
  for (let i = 0; i < points.length; i++) {
    await sdk.http.post("/api/v1/point/data", data[points[i].uuid])
  }
  console.log(data)
};

const handleAlreadyExistsResponse = (e) => {
  if (e.status === 409) {
    return;
  };
  throw e;
}

function camelize(str) {
  return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(word, index) {
    return index === 0 ? word.toLowerCase() : word.toUpperCase();
  }).replace(/\s+/g, '');
}

function markers(m) {
  rv = ""
  for (let i = 0; i < m.length; i++) {
    rv += m[i].name +","
  }
  return rv
}

// parse the spreadsheet date and return a js Date
function makeDate(year, date, time) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  parts = date.match(/(\w{3}), (\d+)\/(\w{3})/)
  dayOfWeek = parts[1]
  dayOfMonth = parts[2]
  month = parts[3]
  jsdate = new Date(year, months.indexOf(month), dayOfMonth, time * 24, (time * 24 * 60) % 60)
  return jsdate
}