"use strict";

/*
 * Created with @iobroker/create-adapter v1.18.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
const mysql = require("mysql2/promise");

//---------- mySQL
let mysql_connection;

let adapter;
function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: "mysql",
        //#######################################
        //
        ready: function () {
            try {
                //adapter.log.debug('start');
                main();
            }
            catch (e) {
                adapter.log.error("exception catch after ready [" + e + "]");
            }
        },
        //#######################################
        //  is called when adapter shuts down
        unload: function (callback) {
            try {
                adapter && adapter.log && adapter.log.info && adapter.log.info("cleaned everything up...");
                Disconnect();
                callback();
            } catch (e) {
                callback();
            }



        },
        //#######################################
        //
        SIGINT: function () {
            adapter && adapter.log && adapter.log.info && adapter.log.info("cleaned everything up...");
            Disconnect();
        },
        //#######################################
        //  is called if a subscribed object changes
        //objectChange: function (id, obj) {
        //    adapter.log.debug('[OBJECT CHANGE] ==== ' + id + ' === ' + JSON.stringify(obj));
        //},
        //#######################################
        // is called if a subscribed state changes
        stateChange: function (id, state) {
            //adapter.log.debug('[STATE CHANGE] ==== ' + id + ' === ' + JSON.stringify(state));
            HandleStateChange(id, state);
        },
        //#######################################
        //
        message: async (obj) => {
            if (obj) {
                switch (obj.command) {
                case "getTables":
                    adapter.log.debug("got get tables");
                    await ListTables(obj);
                    break;
                case "importData":
                    adapter.log.debug("got importData");
                    await ImportData(obj);
                    break;
                default:
                    adapter.log.error("unknown message " + obj.command);
                    break;
                }
            }
        }
    });
    adapter = new utils.Adapter(options);

    return adapter;
}



//#######################################
//
async function main() {
    try {
        
        await CreateDatepoints();

        await SubscribeStates();

        await Connect();
       
    }
    catch (e) {
        adapter.log.error("exception in  main [" + e + "]");
    }
}


async function Connect() {

    try {
        adapter.log.info("start connection");
        adapter.log.debug("--- connecting to " + adapter.config.SQL_IP + " " + adapter.config.SQL_Port + " " + adapter.config.SQL_Databasename);

        mysql_connection = await mysql.createConnection({
            host: adapter.config.SQL_IP,
            user: adapter.config.SQL_User,
            database: adapter.config.SQL_Databasename,
            port: adapter.config.SQL_Port,
            password: adapter.config.SQL_Password,
        });
    }
    catch (e) {
        adapter.log.error("exception in  Connect [" + e + "]");
    }
}

function Disconnect() {

    try {
        mysql_connection.end();
        adapter.log.info("mySQL Database disconnected");
    }
    catch (e) {
        adapter.log.error("exception in  Disconnect [" + e + "]");
    }
}

async function ImportData(obj) {

    //csv import

    try {
        let StartRow = 0;
        const rows = obj.message.rows;
        const separator = obj.message.separator;
        const headers = rows[0].split(separator);
        adapter.log.debug(" headers : " + headers.length + " = " + JSON.stringify(headers));

        let querystring = "";
        if (obj.message.FirstLineIsHeadline) {
            StartRow = 1;
            adapter.log.debug("first line is headline");

            //adapter.log.debug("222 " + JSON.stringify(rows));


            if (obj.message.createcols) {
                adapter.log.debug("creating columns");

                querystring = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '" + obj.message.table + "'";

                const [rows, fields] = await mysql_connection.query(querystring);

                adapter.log.debug("got result: " + JSON.stringify(rows));

                if (rows.length > 0) {

                    for (let i = 0; i < headers.length;i++) {

                        if (headers[i].length > 0) {

                            //check if already available; if not add column
                            let bFound = false;
                            for (let j in rows) {
                                if (headers[i] == rows[j].COLUMN_NAME) {
                                    bFound = true;
                                }

                            }
                            if (!bFound) {
                                adapter.log.debug("column to add " + headers[i]);

                                //to do: spaces und andere Sonderzeichen herausfiltern

                                querystring = "ALTER TABLE " + obj.message.table + " ADD " + headers[i] + " VARCHAR (50)";
                                //to do: correct data type

                                await mysql_connection.query(querystring);
                            }
                            else {
                                adapter.log.debug("column " + headers[i] + " already available");
                            }
                        }
                    }
                }
            }
        }

        //prepare query string with constant part
        let prequerystring = "INSERT INTO " + obj.message.table + " (";

        const col2Import =[];

        for (let i = 0; i < headers.length; i++) {
            if (headers[i].length > 0) {
                if (i > 0) {
                    prequerystring += ", ";
                }

                prequerystring += headers[i];

                col2Import.push(i.toString());
            }
        }
        prequerystring += ")  VALUES (";

        let LastImportDate;
        let LastImportValue =0;

        for (let n = StartRow; n < rows.length; n++) {

            //INSERT INTO table_name (column_list) VALUES(value_list);

            const rowCells = rows[n].split(separator);

            if (obj.message.FillUp) {
                //adapter.log.debug("need to fillup, but not implemented yet");

                const CurrentImportDate = new Date();

                //to do make col number adjustable
                const sDate = rowCells[0].split('.');
                CurrentImportDate.setDate(parseInt(sDate[0]));
                CurrentImportDate.setMonth(parseInt(sDate[1]) - 1);
                CurrentImportDate.setFullYear(parseInt(sDate[2]));
                CurrentImportDate.setHours(12);
                CurrentImportDate.setMinutes(0);

                //to do make col number adjustable
                const CurrentImportValue = parseFloat( RemoveChars(rowCells[1]));
                const CurrentImportDiff = parseFloat ( RemoveChars(rowCells[3]));

                if (typeof LastImportDate !== "undefined") {

                    //adapter.log.debug(rowCells[0] + " last " + LastImportDate.toDateString() + " current " + CurrentImportDate.toDateString());

                    const diffTime = Math.abs(CurrentImportDate.getTime() - LastImportDate.getTime());
                    let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    diffDays--;

                    const ValuePerDay = CurrentImportDiff / diffDays;
                    let NewValue = LastImportValue;
                    let NewDate = LastImportDate;

                    //adapter.log.debug("day diff " + diffDays + " value per day " + ValuePerDay + " " + CurrentImportDiff);

                    for (let d = 0; d < diffDays; d++) {
                        NewValue += ValuePerDay;
                        NewDate = new Date(NewDate.getTime() + 1000 * 60 * 60 * 24);
                        //to do hier fehlt berechnung des Tages
                        //adapter.log.debug("interpolation day " + NewDate.toDateString() + " value " + NewValue);

                        querystring = prequerystring;


                        //INSERT INTO Strom(Datum, Zaehlerstand, Verbrauch, Versorgerablese, Notiz, Kennzeichnung)  VALUES('2008-12-16', 648.8, 0, 'Nein', '', '')

                        for (let j = 0; j < rowCells.length; j++) {
                            //only values with header
                            if (col2Import.includes(j.toString())) {

                                if (j > 0) {
                                    querystring += ", ";
                                }

                                //to do make col number adjustable
                                if (j === 0) { // date
                                    querystring += "'" + NewDate.getFullYear() + "-" + (NewDate.getMonth() + 1) + "-" + NewDate.getDate() + "'";
                                }
                                else if (j === 1) { //value
                                    querystring += NewValue;
                                }
                                else if (j === 3) { //value per day
                                    querystring += ValuePerDay;
                                }
                                else {
                                    querystring += "'";
                                    querystring += rowCells[j];
                                    querystring += "'";
                                }
                               
                            }
                        }
                        querystring += ")";
                        adapter.log.debug(querystring);

                        const [rows, fields] = await mysql_connection.execute(querystring);

                    }

                    if (Math.abs(NewValue - CurrentImportValue) > 1) {
                        adapter.log.warn("calculation diff " + NewValue + " / " + CurrentImportValue);
                    }

                    

                }
                else {
                    // direkt eintragen ohne interpol

                    querystring = prequerystring;

                    for (let j = 0; j < rowCells.length; j++) {
                        //only values with header
                        if (col2Import.includes(j.toString())) {

                            if (j > 0) {
                                querystring += ", ";
                            }

                            //to do make col number adjustable
                            if (j === 0) { // date
                                querystring += "'" + CurrentImportDate.getFullYear() + "-" + (CurrentImportDate.getMonth() + 1) + "-" + CurrentImportDate.getDate() + "'";
                            }
                            else if (j === 1) { //value
                                querystring += CurrentImportValue;
                            }
                            else if (j === 3) { //value per day
                                querystring += CurrentImportDiff;
                            }
                            else {
                                querystring += "'";
                                querystring += rowCells[j];
                                querystring += "'";
                            }
                            
                        }
                    }
                    querystring += ")";
                    adapter.log.debug(querystring);

                    const [rows, fields] = await mysql_connection.execute(querystring);
                }
                LastImportDate = CurrentImportDate;
                LastImportValue = CurrentImportValue;

            }
            else {
                querystring = prequerystring;

                for (let j in rowCells) {
                    //only values with header
                    if (col2Import.includes(j)) {
                        querystring += "'";
                        querystring += rowCells[j];
                        querystring += "', ";
                    }
                }
                querystring += ")";
                const [rows, fields] = await mysql_connection.execute(querystring);
               
            }
            

        }
    }
    catch (e) {
        adapter.log.error("exception in  ImportData [" + e + "]");
    }
    adapter.sendTo(obj.from, obj.command, null, obj.callback);
}

function RemoveChars(input) {

    let output = input;
    if (typeof input !== "undefined") {

        // to do: make it adjustable...
        output = input.replace('.', '');

        output = output.replace(',', '.');
    }
    
    return output;
}


async function ListTables(obj) {

    const tables = [];
    try {

        const querystring = "SHOW TABLES in " + adapter.config.SQL_Databasename;

        adapter.log.debug("query: " + querystring);

        const [rows, fields] = await mysql_connection.query(querystring);

        adapter.log.debug("got result: " + JSON.stringify(rows));

        if (rows.length > 0) {

            for (let i in rows) {
                adapter.log.debug("row: " + JSON.stringify(rows[i][fields[0].name]));

                tables.push(rows[i][fields[0].name]);
            }
        }
    }
    catch (e) {
        adapter.log.error("exception in  ListTables [" + e + "]");
    }
    adapter.sendTo(obj.from, obj.command, tables, obj.callback);
}

async function HandleQuery(state) {

    try {
        const querystring = state.val;

        adapter.log.debug("query: " + querystring);

        const [rows, fields] = await mysql_connection.query(querystring);

        adapter.log.debug("got result: " + JSON.stringify(rows));

        if (rows.length > 0) {
            adapter.log.debug("got result: " + JSON.stringify(rows));
        }
    }
    catch (e) {
        adapter.log.error("exception in  HandleQuery [" + e + "]");
    }
}

//#######################################
//
// create all necessary datapaoints
// will be called at ecery start of adapter
async function CreateDatepoints() {

    adapter.log.debug("start CreateDatepoints");

    try {
        await adapter.setObjectNotExistsAsync("Query", {
            type: "state",
            common: {
                name: "Query",
                type: "string",
                role: "query",
                unit: "",
                read: true,
                write: true
            },
            native: { id: "Query" }
        });

        await adapter.setObjectNotExistsAsync("Result", {
            type: "state",
            common: {
                name: "Result",
                type: "string",
                role: "query",
                unit: "",
                read: true,
                write: false
            },
            native: { id: "Result" }
        });

    }
    catch (e) {
        adapter.log.error("exception in CreateDatapoints [" + e + "]");
    }

    adapter.log.debug("CreateDatepoints done");
}

//#######################################
//
// subscribe thermostate states to be informed when target or current is changed
function SubscribeStates(callback) {

    //if we need to handle actors, then subscribe on current and target temperature
    adapter.log.debug("#start subscribtion ");

    try {

        adapter.subscribeStates("Query");
        
        adapter.log.debug("#subscribtion finished");
    }
    catch (e) {
        adapter.log.error("exception in SubscribeStates [" + e + "]");
    }
    if (callback) callback();
}

//*******************************************************************
//
// handles state changes of subscribed states
async function HandleStateChange(id, state) {

    adapter.log.debug("### handle state change " + id + " " + JSON.stringify(state));

    try {

        if (state && state.ack !== true) {
            //first set ack flag
            await adapter.setStateAsync(id, { ack: true });

            //execute only if ack not set yet
            if (id.includes("Query")) {
                await HandleQuery(state);
            }

        }

        


    }
    catch (e) {
        adapter.log.error("exception in HandleStateChange [" + e + "]");
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}



