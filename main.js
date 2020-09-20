"use strict";

/*
 * Created with @iobroker/create-adapter v1.18.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

const mysql = require("mysql2/promise");

//---------- mySQL
let mysql_connection;
let bIsConnected = false;

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

        await Connect(); //we need a connected database for createDatapoints

        await CreateDatepoints();

        await SubscribeStates();
       
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

        bIsConnected = true;

        mysql_connection.on("error", err => {
            adapter.log.error("Error on connection: " + err.message);
            // stop doing stuff with conn
            Disconnect();
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
        bIsConnected = false;
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

        if (!bIsConnected) {
            Connect();
        }


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

        if (!bIsConnected) {
            Connect();
        }

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
            case "1":
                data.separator = ",";
                break;
            case "2":
                data.separator = ";";
                break;
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

                const sDate = rowCells[0].split(".");
                //to do make col number adjustab

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

               

                const current = {
                    value: CurrentImportValue,
                    diff: CurrentImportDiff,
                    date: CurrentImportDate
                };

                const last = {
                    value: LastImportValue,
                    date: LastImportDate
                };

                await FillUpData(current, last, rowCells, prequerystring, data.datatypes);

                
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

    await mysql_connection.execute(querystring);

}

async function FillUpData(current, last, rowCells, preparedQuery, datatypes) {
    /*
    const current = {
        value: CurrentImportValue,
        diff: CurrentImportDiff,
        date: CurrentImportDate
    };

    const last = {
        value: LastImportValue,
        date: LastImportDate
    };
    */

    let querystring = "";

    if (typeof last.value !== undefined) {

        adapter.log.debug(rowCells[0] + " last " +last.date.toDateString() + " current " + current.date.toDateString());

        const diffTime = Math.abs(current.date.getTime() - last.date.getTime());
        let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        diffDays--;

        const ValuePerDay = current.diff / diffDays;
        let NewValue = last.value;
        const NewDate = last.date;

        adapter.log.debug("day diff " + diffDays + " value per day " + ValuePerDay + " " + current.diff);

        for (let d = 0; d < diffDays; d++) {
            NewValue += ValuePerDay;

            //const nTime = NewDate.getTime();
            //NewDate = new Date(nTime + (1000 * 60 * 60 * 24));
            NewDate.setDate(NewDate.getDate() + 1);

            adapter.log.debug("interpolation day " + NewDate.toDateString() + " value " + NewValue);

            querystring = preparedQuery;


            //INSERT INTO Strom(Datum, Zaehlerstand, Verbrauch, Versorgerablese, Notiz, Kennzeichnung)  VALUES('2008-12-16', 648.8, 0, 'Nein', '', '')

            //############################
            //prepare row

            rowCells[0] = NewDate.getFullYear() + "-" + (NewDate.getMonth() + 1) + "-" + NewDate.getDate();
            rowCells[1] = NewValue;
            rowCells[3] = ValuePerDay;



            await WriteRow(querystring, rowCells, datatypes);

            adapter.log.debug("**##*** " + rowCells[0] + " " + current.date.toDateString() + " " + rowCells[1] + " " + rowCells[3]);
        }

        if (Math.abs(NewValue - current.value) > 1) {
            adapter.log.warn("calculation diff " + NewValue + " / " + current.value);
        }
    }
    else {
        // direkt eintragen ohne interpol, da erster wert
        adapter.log.debug("direct, data " + rowCells[0] + " " + rowCells[1] + " " + rowCells[3] + " " + current.date.toDateString());
        querystring = preparedQuery;

        //############################
        // prepare row

        rowCells[0] = current.date.getFullYear() + "-" + (current.date.getMonth() + 1) + "-" + current.date.getDate();
        rowCells[1] = current.value;
        rowCells[3] = current.diff;

        adapter.log.debug("***** " + rowCells[0] + " " + current.date.toDateString() + " " + rowCells[1] + " " + rowCells[3]);


        await WriteRow(querystring, rowCells, datatypes);

    }

}

function RemoveChars(input) {

    let output = input;

    adapter.log.debug("RemoveChars " + input + " " + typeof input);

    if (typeof input === "string") {

        // to do: make it adjustable...
        output = input.replace(".", "");

        output = output.replace(",", ".");
    }
    
    return output;
}


async function ListTables(obj) {

    const tables = [];
    try {

        if (!bIsConnected) {
            Connect();
        }

        const querystring = "SHOW TABLES in " + adapter.config.SQL_Databasename;

        adapter.log.debug("query: " + querystring);

        const [rows, fields] = await mysql_connection.query(querystring);

        adapter.log.debug("got result: " + JSON.stringify(rows));

        if (rows.length > 0) {

            for (const i in rows) {
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
        if (!bIsConnected) {
            Connect();
        }

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

async function HandleQueries() {

    try {


        if (!bIsConnected) {
            Connect();
        }

        for (let i = 0; i < adapter.config.queries.length; i++) {

            if (adapter.config.queries[i].fillup) {

                await FillUp(i);

            }
            else {


                let querystring = adapter.config.queries[i].query;

                if (adapter.config.queries[i].withInput) {
                    const values = await adapter.getStateAsync("Input_" + adapter.config.queries[i].name);

                    const sValues = values.val.split(",");

                    for (let n = 0; n < sValues.length; n++) {

                        const searchstring = "#" + (n + 1);

                        querystring = querystring.replace(searchstring, sValues[n]);
                    }
                }


                adapter.log.debug("query: " + querystring);

                const [rows, fields] = await mysql_connection.query(querystring);

                adapter.log.debug("got result: " + JSON.stringify(rows));

                if (rows.length > 0) {
                    adapter.log.debug("got result: " + JSON.stringify(rows));

                    await adapter.setStateAsync("Result_" + adapter.config.queries[i].name, { ack: true, val: JSON.stringify(rows) });

                }
            }
        }
    }
    catch (e) {
        adapter.log.error("exception in  HandleQuery [" + e + "]");
    }
}

async function FillUp(query) {

    try {

        //find out which table
        //INSERT INTO Heizung (Datum, Zaehlerstand, Verbrauch) VALUES ('#1', #2, #3)
        const searchstring = "INTO";
        const start = query.indexOf(searchstring) + searchstring.length;
        const ende = query.indexOf("(", start);

        if (start > 0 && ende > 0 && ende > start) {
            const tablename = query.substring(start, ende - start).trim();
            adapter.log.debug("table name to fill up is " + tablename);

            //get last entry
            //select * from Heizung order BY ID desc limit 1
            const querystring = "select * from " + tablename + "order BY ID desc limit 1";
            adapter.log.debug("query: " + querystring);

            const [rows, fields] = await mysql_connection.query(querystring);

            adapter.log.debug("got result: " + JSON.stringify(rows));

            if (rows.length > 0) {
                adapter.log.debug("got result: " + JSON.stringify(rows));

                //calculate difference to current dataset




                //claculate value per day

                //loop over all necessary data sets
            }
            else {
                adapter.log.error("no entry found for " + querystring);
            }

        }
        else {
            adapter.log.error("table name not found " + query + " to fillup");
        }

    }
    catch (e) {
        adapter.log.error("exception in  FillUp [" + e + "]");
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


        if (adapter.config.queries != null && typeof adapter.config.queries != undefined && adapter.config.queries.length > 0) {

            await adapter.setObjectNotExistsAsync("ExecuteQueries", {
                type: "state",
                common: {
                    name: "Result",
                    type: "boolean",
                    role: "query",
                    unit: "",
                    read: true,
                    write: true
                },
                native: { id: "ExecuteQueries" }
            });



            for (let i = 0; i < adapter.config.queries.length; i++) {

                await adapter.setObjectNotExistsAsync("Result_"+adapter.config.queries[i].name, {
                    type: "state",
                    common: {
                        name: "Result",
                        type: "string",
                        role: "query",
                        unit: "",
                        read: true,
                        write: false
                    },
                    native: { id: "Result_" + adapter.config.queries[i].name }
                });

                if (adapter.config.queries[i].withInput) {
                    await adapter.setObjectNotExistsAsync("Input_" + adapter.config.queries[i].name, {
                        type: "state",
                        common: {
                            name: "Input",
                            type: "string",
                            role: "query",
                            unit: "",
                            read: true,
                            write: true
                        },
                        native: { id: "Input_" + adapter.config.queries[i].name }
                    });
                }

            }

        }

        if (adapter.config.InsertNewValuesFromVis) {
            await adapter.setObjectNotExistsAsync("vis.Date", {
                type: "state",
                common: {
                    name: "Input Date",
                    type: "string",
                    role: "value",
                    unit: "",
                    read: true,
                    write: true
                },
                native: { id: "vis.Date"}
            });

            await adapter.setObjectNotExistsAsync("vis.Update", {
                type: "state",
                common: {
                    name: "Button Update",
                    type: "boolean",
                    role: "button",
                    unit: "",
                    read: false,
                    write: true
                },
                native: { id: "vis.Update" }
            });

            await adapter.setObjectNotExistsAsync("vis.Opened", {
                type: "state",
                common: {
                    name: "Button Opened",
                    type: "boolean",
                    role: "button",
                    unit: "",
                    read: false,
                    write: true
                },
                native: { id: "vis.Opened" }
            });
            
            const querystring = "SHOW TABLES in " + adapter.config.SQL_Databasename;

            adapter.log.debug("query: " + querystring);

            const [rows, fields] = await mysql_connection.query(querystring);

            adapter.log.debug("got result: " + JSON.stringify(rows));

            if (rows.length > 0) {

                for (const i in rows) {

                    await adapter.setObjectNotExistsAsync("vis.NewValue_" + rows[i][fields[0].name], {
                        type: "state",
                        common: {
                            name: "Input Value for table " + rows[i][fields[0].name],
                            type: "string",
                            role: "value",
                            unit: "",
                            read: true,
                            write: true
                        },
                        native: { id: "vis.NewValue_" + rows[i][fields[0].name] }
                    });

                    await adapter.setObjectNotExistsAsync("vis.LastUpdate_" + rows[i][fields[0].name], {
                        type: "state",
                        common: {
                            name: "Last update of table " + rows[i][fields[0].name],
                            type: "string",
                            role: "value",
                            unit: "",
                            read: true,
                            write: true
                        },
                        native: { id: "vis.LastUpdate_" + rows[i][fields[0].name] }
                    });

                    
                }
            }




        }

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

        if (adapter.config.queries != null && typeof adapter.config.queries != undefined && adapter.config.queries.length > 0) {
            adapter.subscribeStates("ExecuteQueries");

            for (let i = 0; i < adapter.config.queries.length; i++) {

                if (adapter.config.queries[i].withInput) {
                    adapter.subscribeStates("Input_" + adapter.config.queries[i].name);
                }
            }

        }

        if (adapter.config.InsertNewValuesFromVis) {
            adapter.subscribeStates("vis.Update");
            adapter.subscribeStates("vis.Opened");
        }


        adapter.log.debug("#subscribtion finished");
    }
    catch (e) {
        adapter.log.error("exception in SubscribeStates [" + e + "]");
    }
    if (callback) callback();
}


function TimeConverter(UNIX_timestamp) {

    let a;

    if (typeof UNIX_timestamp !== undefined && UNIX_timestamp > 0) {
        a = new Date(UNIX_timestamp * 1000);
    }
    else {
        a = new Date();
    }

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    /*
    if (this.language === "de") {
        months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    }
    */
    const year = a.getFullYear();
    const month = months[a.getMonth()];
    const date = ("0" + a.getDate()).slice(-2);
    const hour = ("0" + a.getHours()).slice(-2);
    const min = ("0" + a.getMinutes()).slice(-2);
    const sec = ("0" + a.getSeconds()).slice(-2);
    const time = date + " " + month + " " + year + " " + hour + ":" + min + ":" + sec;
    return time;
}

//*******************************************************************
//
// handles state changes of subscribed states
async function HandleStateChange(id, state) {

    adapter.log.debug("### handle state change " + id + " " + JSON.stringify(state));

    try {

        if (state && state.ack !== true) {
            //first set ack flag
            await adapter.setStateAsync(id, { val: state.val, ack: true });

            if (id.includes("ExecuteQueries")) {
                await HandleQueries();
            }
            else if (id.includes("Query")) {
                await HandleQuery(state);
            }
            else if (id.includes("vis.Update")) {
                await VisUpdate();
            }
            else if (id.includes("vis.Opened")) {
                await VisOpened();
            }
        }
    }
    catch (e) {
        adapter.log.error("exception in HandleStateChange [" + e + "]");
    }
}

async function VisOpened() {
    await adapter.setStateAsync("vis.Date", TimeConverter());

    try {


        if (!bIsConnected) {
            Connect();
        }

        let querystring = "SHOW TABLES in " + adapter.config.SQL_Databasename;

        adapter.log.debug("query: " + querystring);

        const [rows, fields] = await mysql_connection.query(querystring);

        adapter.log.debug("got result: " + JSON.stringify(rows));

        if (rows.length > 0) {

            for (const i in rows) {

                const tablename = rows[i][fields[0].name];

                querystring = "select * from " + tablename + " order by Datum DESC limit 1";
                adapter.log.debug("query: " + querystring);

                const [rows1, fields1] = await mysql_connection.query(querystring);

                adapter.log.debug("got result: " + JSON.stringify(rows1));
                if (rows1.length > 0) {

                    const lastValue = rows1[0].Zaehlerstand;
                    const lastDate = new Date(rows1[0].Datum);


                    
                    adapter.log.debug("got last value for " + tablename + " : " + lastValue + " from " + lastDate + " " );

                    await adapter.setStateAsync("vis.NewValue_" + tablename, lastValue);

                    await adapter.setStateAsync("vis.LastUpdate_" + tablename, lastDate.toDateString());

                }
            }
        }

    }
    catch (e) {
        adapter.log.error("exception in VisOpened [" + e + "]");
    }

}


async function VisUpdate() {

    const oimportDate = await adapter.getStateAsync("vis.Date");
    const importDate = new Date(oimportDate.val);

    try {

        if (!bIsConnected) {
            Connect();
        }

        //get all tables
        const querystring = "SHOW TABLES in " + adapter.config.SQL_Databasename;

        adapter.log.debug("query: " + querystring);

        const [rows, fields] = await mysql_connection.query(querystring);

        adapter.log.debug("got result: " + JSON.stringify(rows));

        if (rows.length > 0) {

            for (const i in rows) {

                //get last data row in database
                let LastImportValue;
                let LastImportDate;
                const tablename = rows[i][fields[0].name];

                const querystring = "select * from " + tablename + " order by Datum DESC limit 1";
                adapter.log.debug("query: " + querystring);

                const [rows1, fields1] = await mysql_connection.query(querystring);

                adapter.log.debug("got result: " + JSON.stringify(rows1));
                if (rows1.length > 0) {

                    LastImportValue = rows1[0].Zaehlerstand;
                    LastImportDate = new Date(rows1[0].Datum);
                    adapter.log.debug("got last value for " + tablename + " : " + LastImportValue + " from " + LastImportDate.toDateString());
                }

                const importValue = await adapter.getStateAsync("vis.NewValue_" + tablename);

                const importDiff = importValue.val - LastImportValue;

                adapter.log.debug("new values for " + tablename + " " + importDate.toDateString() + " " + importValue.val + " " + importDiff);

                const current = {
                    value: importValue.val,
                    diff: importDiff,
                    date: importDate
                };

                const last = {
                    value: LastImportValue,
                    date: LastImportDate
                };

                if (importValue.val >= LastImportValue) {

                    if (importDate > LastImportDate) {
                        const prequerystring = "INSERT INTO " + tablename + " (Datum,Zaehlerstand,Verbrauch)  VALUES (";
                        const rowCells = [0, 0, 0, 0];
                        const datatypes = ["date", "float", "none", "float"];

                        await FillUpData(current, last, rowCells, prequerystring, datatypes);
                    }
                    else {
                        adapter.log.error("import date before last import date" + importDate.toDateString() + " < " + LastImportDate.toDateString());
                    }
                }
                else {
                    adapter.log.error("new value smaller than old value" + importValue.val + " < " + LastImportValue);
                }


            }
        }
    }
    catch (e) {
        adapter.log.error("exception in VisUpdate [" + e + "]");
    }

    adapter.log.info("### import done");

    await HandleQueries();

    adapter.log.info("### query done");

    await VisOpened();

    adapter.log.info("### finished");
}

/*
 * mysql.0	2020-05-23 16:43:01.054	error	(7685) exception in HandleStateChange [TypeError: current.date.toDateString is not a function]
mysql.0	2020-05-23 16:43:01.047	debug	(7685) got last value for Heizung : 29843 from Thu Dec 26 2019 00:00:00 GMT+0100 (Central European Standard Time)
mysql.0	2020-05-23 16:43:01.045	debug	(7685) got result: [{"ID":4019,"Datum":"2019-12-25T23:00:00.000Z","Zaehlerstand":29843,"Verbrauch":47.2727}]
mysql.0	2020-05-23 16:43:01.036	debug	(7685) query: select * from Heizung order by Datum DESC limit 1
mysql.0	2020-05-23 16:43:01.034	debug	(7685) got result: [{"Tables_in_Verbrauch":"Heizung"},{"Tables_in_Verbrauch":"PVStrom"},{"Tables_in_Verbrauch":"Strom"},{"Tables_in_Verbrauch":"WPStrom"},{"Tables_in_Verbrauch":"Wasser"}]
mysql.0	2020-05-23 16:43:01.029	debug	(7685) query: SHOW TABLES in Verbrauch
 * 
 * /

/**
 * 
 * 
 * @param {string} timeVal
 * @param {string} timeLimit
 */
function IsLater(timeVal, timeLimit) {

    let ret = false;
    try {
        adapter.log.debug("check IsLater : " + timeVal + " " + timeLimit);

        if (typeof timeVal === "string" && typeof timeLimit === "string") {
            const valIn = timeVal.split(":");
            const valLimits = timeLimit.split(":");

            if (valIn.length > 1 && valLimits.length > 1) {

                if (parseInt(valIn[0]) > parseInt(valLimits[0])
                    || (parseInt(valIn[0]) == parseInt(valLimits[0]) && parseInt(valIn[1]) > parseInt(valLimits[1]))) {
                    ret = true;
                    adapter.log.debug("yes, IsLater : " + timeVal + " " + timeLimit);
                }
            }
            else {
                adapter.log.error("string does not contain : " + timeVal + " " + timeLimit);
            }
        }
        else {
            adapter.log.error("not a string " + typeof timeVal + " " + typeof timeLimit);
        }
    }
    catch (e) {
        adapter.log.error("exception in IsLater [" + e + "]");
    }
    return ret;
}

/**
 * @param {string } timeVal
 * @param {string } [timeLimit]
 */
function IsEarlier(timeVal, timeLimit) {

    let ret = false;
    try {
        adapter.log.debug("check IsEarlier : " + timeVal + " " + timeLimit);

        if (typeof timeVal === "string" && typeof timeLimit === "string") {
            const valIn = timeVal.split(":");
            const valLimits = timeLimit.split(":");

            if (valIn.length > 1 && valLimits.length > 1) {

                if (parseInt(valIn[0]) < parseInt(valLimits[0])
                    || (parseInt(valIn[0]) == parseInt(valLimits[0]) && parseInt(valIn[1]) < parseInt(valLimits[1]))) {
                    ret = true;
                    adapter.log.debug("yes, IsEarlier : " + timeVal + " " + timeLimit);
                }
            }
            else {
                adapter.log.error("string does not contain : " + timeVal + " " + timeLimit);
            }
        }
        else {
            adapter.log.error("not a string " + typeof timeVal + " " + typeof timeLimit);
        }
    }
    catch (e) {
        adapter.log.error("exception in IsEarlier [" + e + "]");
    }
    return ret;
}

/**
 * @param {string} timeVal
 * @param {string} timeLimit
 */
function IsEqual(timeVal, timeLimit) {

    let ret = false;
    try {
        adapter.log.debug("check IsEqual : " + timeVal + " " + timeLimit);

        if (typeof timeVal === "string" && typeof timeLimit === "string") {
            const valIn = timeVal.split(":");
            const valLimits = timeLimit.split(":");

            if (valIn.length > 1 && valLimits.length > 1) {

                if (parseInt(valIn[0]) === parseInt(valLimits[0]) && parseInt(valIn[1]) === parseInt(valLimits[1])) {
                    ret = true;
                    adapter.log.debug("yes, IsEqual : " + timeVal + " " + timeLimit);
                }
            }
            else {
                adapter.log.error("string does not contain : " + timeVal + " " + timeLimit);
            }
        }
        else {
            adapter.log.error("not a string " + typeof timeVal + " " + typeof timeLimit);
        }
    }
    catch (e) {
        adapter.log.error("exception in IsEqual [" + e + "]");
    }
    return ret;
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}



