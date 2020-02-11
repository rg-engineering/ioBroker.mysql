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
                case "createTable":
                    adapter.log.debug("got createTable");
                    await CreateTable(obj);
                    //to do
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

async function CreateTable(obj) {

    /*
    CREATE TABLE Persons(
        PersonID int,
        LastName varchar(255),
        FirstName varchar(255),
        Address varchar(255),
        City varchar(255)
    );
    */

    try {

        adapter.log.debug("create table " + obj.message.table);
        //to do: spaces und andere Sonderzeichen herausfiltern

        if (typeof obj.message.table == "string" && obj.message.table.length > 0) {

            const querystring = "CREATE TABLE " + obj.message.table + " ( ID int NOT NULL AUTO_INCREMENT, PRIMARY KEY (ID) ) ";

            adapter.log.debug(querystring);
            await mysql_connection.query(querystring);
        }
        else {
            adapter.log.error("create table: name not valid " + JSON.stringify(obj.message.table));
        }

    }
    catch (e) {
        adapter.log.error("exception in  CreateTable [" + e + "]");
    }
    adapter.sendTo(obj.from, obj.command, null, obj.callback);
}

async function ImportData(obj) {

    //csv import
    try {

        const data = {
            allRows: obj.message.allRows,
            datatypes: obj.message.datatypes,
            separator: "",       
            filetype: obj.message.filetype,
            headerIsFirstLine: obj.message.headerIsFirstLine,
            createColumns: obj.message.createColumns,
            fillUp: obj.message.fillUp,
            table: obj.message.table
        };

        switch (obj.message.separator) {
        case "1": data.separator = ","; break;
        case "2": data.separator = ";"; break;
        default:
            adapter.log.error("no separator defined " + obj.message.separator);
            break;
        }

        //to do: filetype prüfen, ob wirklich csv
        //to do: header length und datatype length must have the same length

        const row0 = data.allRows[0];
        const headers = row0.split(data.separator);
        adapter.log.debug(" headers : " + headers.length + " = " + JSON.stringify(headers) + " " + data.separator);
        adapter.log.debug(" datatypes : " + JSON.stringify(data.datatypes));

        let StartRow = 0;
        let querystring = "";
        if (data.headerIsFirstLine) {
            adapter.log.debug("first line is headline");
            StartRow = 1;

            if (data.createColumns) {
                adapter.log.debug("creating columns");
                querystring = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '" + data.table + "'";
                const [rows, fields] = await mysql_connection.query(querystring);
                adapter.log.debug("got columns: " + JSON.stringify(rows));

                if (rows.length > 0) {
                    for (let i = 0; i < headers.length; i++) {
                        if (headers[i].length > 0 && data.datatypes[i] != "none") {

                            //check if already available; if not add column
                            let bFound = false;
                            for (const j in rows) {
                                if (headers[i] == rows[j].COLUMN_NAME) {
                                    bFound = true;
                                }
                            }
                            if (!bFound) {
                                adapter.log.debug("column to add " + headers[i] + " as " + data.datatypes[i]);
                                //to do: spaces und andere Sonderzeichen herausfiltern
                                querystring = "ALTER TABLE " + obj.message.table + " ADD " + headers[i] + " " + data.datatypes[i];
                                if (data.datatypes[i] == "varchar") {
                                    querystring += "(255)";
                                }

                                adapter.log.debug(querystring);
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

        adapter.log.debug("start import data");
        //prepare query string with constant part
        let prequerystring = "INSERT INTO " + obj.message.table + " (";

        
        for (let i = 0; i < headers.length; i++) {
            if (headers[i].length>0 && data.datatypes[i] != "none") {
                if (i > 0) {
                    prequerystring += ", ";
                }
                prequerystring += headers[i];
            }
        }
        prequerystring += ")  VALUES (";

        let LastImportDate;
        let LastImportValue =0;

        for (let n = StartRow; n < data.allRows.length; n++) {

            //INSERT INTO table_name (column_list) VALUES(value_list);

            //to check: length of array must be the same as headers

            const rowCells = data.allRows[n].split(data.separator);

            if (data.fillUp) {
               

                const CurrentImportDate = new Date();

                //to do make col number adjustable
                const sDate = rowCells[0].split(".");

                const day = parseInt(sDate[0]);
                const month = parseInt(sDate[1]) - 1;
                const year = parseInt(sDate[2]);

                adapter.log.debug("***** " + day + " + " + month + " + " + year); 

                CurrentImportDate.setFullYear(year);
                CurrentImportDate.setMonth(month);
                CurrentImportDate.setDate(day);
                CurrentImportDate.setHours(12);
                CurrentImportDate.setMinutes(0);

                adapter.log.debug("need to fillup, data " + rowCells[0] + " " + rowCells[1] + " " + rowCells[3] + " " + CurrentImportDate.toDateString());

                //to do make col number for fillup adjustable 
                const CurrentImportValue = parseFloat( RemoveChars(rowCells[1]));
                const CurrentImportDiff = parseFloat ( RemoveChars(rowCells[3]));

                if (typeof LastImportDate !== "undefined") {

                    adapter.log.debug(rowCells[0] + " last " + LastImportDate.toDateString() + " current " + CurrentImportDate.toDateString());

                    const diffTime = Math.abs(CurrentImportDate.getTime() - LastImportDate.getTime());
                    let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    diffDays--;

                    const ValuePerDay = CurrentImportDiff / diffDays;
                    let NewValue = LastImportValue;
                    let NewDate = LastImportDate;

                    adapter.log.debug("day diff " + diffDays + " value per day " + ValuePerDay + " " + CurrentImportDiff);

                    for (let d = 0; d < diffDays; d++) {
                        NewValue += ValuePerDay;

                        //const nTime = NewDate.getTime();
                        //NewDate = new Date(nTime + (1000 * 60 * 60 * 24));
                        NewDate.setDate(NewDate.getDate() + 1);
                      
                        adapter.log.debug("interpolation day " + NewDate.toDateString() + " value " + NewValue );

                        querystring = prequerystring;


                        //INSERT INTO Strom(Datum, Zaehlerstand, Verbrauch, Versorgerablese, Notiz, Kennzeichnung)  VALUES('2008-12-16', 648.8, 0, 'Nein', '', '')

                        //############################
                        //prepare row

                        rowCells[0] = NewDate.getFullYear() + "-" + (NewDate.getMonth() + 1) + "-" + NewDate.getDate();
                        rowCells[1] = NewValue;
                        rowCells[3] = ValuePerDay;
                        await WriteRow(querystring, rowCells, data.datatypes);                      
                    }

                    if (Math.abs(NewValue - CurrentImportValue) > 1) {
                        adapter.log.warn("calculation diff " + NewValue + " / " + CurrentImportValue);
                    }
                }
                else {
                    // direkt eintragen ohne interpol, da erster wert
                    adapter.log.debug("direct, data " + rowCells[0] + " " + rowCells[1] + " " + rowCells[3] + " " + CurrentImportDate.toDateString());
                    querystring = prequerystring;

                    //############################
                    // prepare row

                    rowCells[0] = CurrentImportDate.getFullYear() + "-" + (CurrentImportDate.getMonth() + 1) + "-" + CurrentImportDate.getDate();
                    rowCells[1] = CurrentImportValue;
                    rowCells[3] = CurrentImportDiff;

                    adapter.log.debug("***** " + rowCells[0] + " " + CurrentImportDate.toDateString());


                    await WriteRow(querystring, rowCells, data.datatypes);

                }
                LastImportDate = CurrentImportDate;
                LastImportValue = CurrentImportValue;

            }
            else {

                //immer direkt eintragen
                adapter.log.debug("no fill up");
                querystring = prequerystring;

                await WriteRow(querystring, rowCells, data.datatypes);

            }
        }
    }
    catch (e) {
        adapter.log.error("exception in  ImportData [" + e + "]");
    }
    adapter.sendTo(obj.from, obj.command, null, obj.callback);
}


async function WriteRow(querystring, row, datatypes) {

    let cnt = 0;
    for (let j = 0; j < row.length; j++) {
        //only values with header

        //    wenn string oder datum, dann anführungszeichen

        if (datatypes[j] == "text" || datatypes[j] == "varchar" || datatypes[j] == "date") {

            if (cnt > 0) {
                querystring += ", ";
            }
            querystring += "'";
            querystring += row[j];
            querystring += "'";
            cnt++;
        }
        else if (datatypes[j] == "float") {

            const val = RemoveChars(row[j]);

            if (cnt > 0) {
                querystring += ", ";
            }
            querystring += val;
            cnt++;
        }
        else if (datatypes[j] != "none") {
            if (cnt > 0) {
                querystring += ", ";
            }
            querystring += row[j];
            cnt++;
        }
    }
    querystring += ")";

    adapter.log.debug("query " + querystring);

    const [rows, fields] = await mysql_connection.execute(querystring);

}


function RemoveChars(input) {

    let output = input;

    adapter.log.debug("RemoveChars " + input + " " + typeof input);

    if (typeof input === "string") {

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

        //adapter.log.debug("got result: " + JSON.stringify(rows));

        if (rows.length > 0) {
            adapter.log.debug("got result: " + JSON.stringify(rows));

            await adapter.setStateAsync("Result", { ack: true, val: JSON.stringify(rows)});

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



