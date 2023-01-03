(function e(t, n, r) { function s(o, u) { if (!n[o]) { if (!t[o]) { var a = typeof require == "function" && require; if (!u && a) return a(o, !0); if (i) return i(o, !0); var f = new Error("Cannot find module '" + o + "'"); throw f.code = "MODULE_NOT_FOUND", f } var l = n[o] = { exports: {} }; t[o][0].call(l.exports, function (e) { var n = t[o][1][e]; return s(n ? n : e) }, l, l.exports, e, t, n, r) } return n[o].exports } var i = typeof require == "function" && require; for (var o = 0; o < r.length; o++)s(r[o]); return s })({
    1: [function (require, module, exports) {
        (function (global) {
            var ethJSABI = require("ethjs-abi");
            var BlockchainUtils = require("truffle-blockchain-utils");
            var Web3 = require("web3");

            // For browserified version. If browserify gave us an empty version,
            // look for the one provided by the user.
            if (typeof Web3 == "object" && Object.keys(Web3).length == 0) {
                Web3 = global.Web3;
            }

            var contract = (function (module) {

                // Planned for future features, logging, etc.
                function Provider(provider) {
                    this.provider = provider;
                }

                Provider.prototype.send = function () {
                    return this.provider.send.apply(this.provider, arguments);
                };

                Provider.prototype.sendAsync = function () {
                    return this.provider.sendAsync.apply(this.provider, arguments);
                };

                var BigNumber = (new Web3()).toBigNumber(0).constructor;

                var Utils = {
                    is_object: function (val) {
                        return typeof val == "object" && !Array.isArray(val);
                    },
                    is_big_number: function (val) {
                        if (typeof val != "object") return false;

                        // Instanceof won't work because we have multiple versions of Web3.
                        try {
                            new BigNumber(val);
                            return true;
                        } catch (e) {
                            return false;
                        }
                    },
                    decodeLogs: function (C, instance, logs) {
                        return logs.map(function (log) {
                            var logABI = C.events[log.topics[0]];

                            if (logABI == null) {
                                return null;
                            }

                            // This function has been adapted from web3's SolidityEvent.decode() method,
                            // and built to work with ethjs-abi.

                            var copy = Utils.merge({}, log);

                            function partialABI(fullABI, indexed) {
                                var inputs = fullABI.inputs.filter(function (i) {
                                    return i.indexed === indexed;
                                });

                                var partial = {
                                    inputs: inputs,
                                    name: fullABI.name,
                                    type: fullABI.type,
                                    anonymous: fullABI.anonymous
                                };

                                return partial;
                            }

                            var argTopics = logABI.anonymous ? copy.topics : copy.topics.slice(1);
                            var indexedData = "0x" + argTopics.map(function (topics) { return topics.slice(2); }).join("");
                            var indexedParams = ethJSABI.decodeEvent(partialABI(logABI, true), indexedData);

                            var notIndexedData = copy.data;
                            var notIndexedParams = ethJSABI.decodeEvent(partialABI(logABI, false), notIndexedData);

                            copy.event = logABI.name;

                            copy.args = logABI.inputs.reduce(function (acc, current) {
                                var val = indexedParams[current.name];

                                if (val === undefined) {
                                    val = notIndexedParams[current.name];
                                }

                                acc[current.name] = val;
                                return acc;
                            }, {});

                            Object.keys(copy.args).forEach(function (key) {
                                var val = copy.args[key];

                                // We have BN. Convert it to BigNumber
                                if (val.constructor.isBN) {
                                    copy.args[key] = C.web3.toBigNumber("0x" + val.toString(16));
                                }
                            });

                            delete copy.data;
                            delete copy.topics;

                            return copy;
                        }).filter(function (log) {
                            return log != null;
                        });
                    },
                    promisifyFunction: function (fn, C) {
                        var self = this;
                        return function () {
                            var instance = this;

                            var args = Array.prototype.slice.call(arguments);
                            var tx_params = {};
                            var last_arg = args[args.length - 1];

                            // It's only tx_params if it's an object and not a BigNumber.
                            if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
                                tx_params = args.pop();
                            }

                            tx_params = Utils.merge(C.class_defaults, tx_params);

                            return C.detectNetwork().then(function () {
                                return new Promise(function (accept, reject) {
                                    var callback = function (error, result) {
                                        if (error != null) {
                                            reject(error);
                                        } else {
                                            accept(result);
                                        }
                                    };
                                    args.push(tx_params, callback);
                                    fn.apply(instance.contract, args);
                                });
                            });
                        };
                    },
                    synchronizeFunction: function (fn, instance, C) {
                        var self = this;
                        return function () {
                            var args = Array.prototype.slice.call(arguments);
                            var tx_params = {};
                            var last_arg = args[args.length - 1];

                            // It's only tx_params if it's an object and not a BigNumber.
                            if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
                                tx_params = args.pop();
                            }

                            tx_params = Utils.merge(C.class_defaults, tx_params);

                            return C.detectNetwork().then(function () {
                                return new Promise(function (accept, reject) {
                                    var callback = function (error, tx) {
                                        if (error != null) {
                                            reject(error);
                                            return;
                                        }

                                        var timeout = C.synchronization_timeout || 240000;
                                        var start = new Date().getTime();

                                        var make_attempt = function () {
                                            C.web3.eth.getTransactionReceipt(tx, function (err, receipt) {
                                                if (err) return reject(err);

                                                if (receipt != null) {
                                                    return accept({
                                                        tx: tx,
                                                        receipt: receipt,
                                                        logs: Utils.decodeLogs(C, instance, receipt.logs)
                                                    });
                                                }

                                                if (timeout > 0 && new Date().getTime() - start > timeout) {
                                                    return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                                                }

                                                setTimeout(make_attempt, 1000);
                                            });
                                        };

                                        make_attempt();
                                    };

                                    args.push(tx_params, callback);
                                    fn.apply(self, args);
                                });
                            });
                        };
                    },
                    merge: function () {
                        var merged = {};
                        var args = Array.prototype.slice.call(arguments);

                        for (var i = 0; i < args.length; i++) {
                            var object = args[i];
                            var keys = Object.keys(object);
                            for (var j = 0; j < keys.length; j++) {
                                var key = keys[j];
                                var value = object[key];
                                merged[key] = value;
                            }
                        }

                        return merged;
                    },
                    parallel: function (arr, callback) {
                        callback = callback || function () { };
                        if (!arr.length) {
                            return callback(null, []);
                        }
                        var index = 0;
                        var results = new Array(arr.length);
                        arr.forEach(function (fn, position) {
                            fn(function (err, result) {
                                if (err) {
                                    callback(err);
                                    callback = function () { };
                                } else {
                                    index++;
                                    results[position] = result;
                                    if (index >= arr.length) {
                                        callback(null, results);
                                    }
                                }
                            });
                        });
                    },
                    bootstrap: function (fn) {
                        // Add our static methods
                        Object.keys(fn._static_methods).forEach(function (key) {
                            fn[key] = fn._static_methods[key].bind(fn);
                        });

                        // Add our properties.
                        Object.keys(fn._properties).forEach(function (key) {
                            fn.addProp(key, fn._properties[key]);
                        });

                        return fn;
                    }
                };

                // Accepts a contract object created with web3.eth.contract.
                // Optionally, if called without `new`, accepts a network_id and will
                // create a new version of the contract abstraction with that network_id set.
                function Contract(contract) {
                    var self = this;
                    var constructor = this.constructor;
                    this.abi = constructor.abi;

                    if (typeof contract == "string") {
                        var address = contract;
                        var contract_class = constructor.web3.eth.contract(this.abi);
                        contract = contract_class.at(address);
                    }

                    this.contract = contract;

                    // Provision our functions.
                    for (var i = 0; i < this.abi.length; i++) {
                        var item = this.abi[i];
                        if (item.type == "function") {
                            if (item.constant == true) {
                                this[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
                            } else {
                                this[item.name] = Utils.synchronizeFunction(contract[item.name], this, constructor);
                            }

                            this[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
                            this[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
                            this[item.name].request = contract[item.name].request;
                            this[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
                        }

                        if (item.type == "event") {
                            this[item.name] = contract[item.name];
                        }
                    }

                    this.sendTransaction = Utils.synchronizeFunction(function (tx_params, callback) {
                        if (typeof tx_params == "function") {
                            callback = tx_params;
                            tx_params = {};
                        }

                        tx_params.to = self.address;

                        constructor.web3.eth.sendTransaction.apply(constructor.web3.eth, [tx_params, callback]);
                    }, this, constructor);

                    this.send = function (value) {
                        return self.sendTransaction({ value: value });
                    };

                    this.allEvents = contract.allEvents;
                    this.address = contract.address;
                    this.transactionHash = contract.transactionHash;
                };

                Contract._static_methods = {
                    setProvider: function (provider) {
                        if (!provider) {
                            throw new Error("Invalid provider passed to setProvider(); provider is " + provider);
                        }

                        var wrapped = new Provider(provider);
                        this.web3.setProvider(wrapped);
                        this.currentProvider = provider;
                    },

                    new: function () {
                        var self = this;

                        if (this.currentProvider == null) {
                            throw new Error(this.contract_name + " error: Please call setProvider() first before calling new().");
                        }

                        var args = Array.prototype.slice.call(arguments);

                        if (!this.unlinked_binary) {
                            throw new Error(this._json.contract_name + " error: contract binary not set. Can't deploy new instance.");
                        }

                        return self.detectNetwork().then(function (network_id) {
                            // After the network is set, check to make sure everything's ship shape.
                            var regex = /__[^_]+_+/g;
                            var unlinked_libraries = self.binary.match(regex);

                            if (unlinked_libraries != null) {
                                unlinked_libraries = unlinked_libraries.map(function (name) {
                                    // Remove underscores
                                    return name.replace(/_/g, "");
                                }).sort().filter(function (name, index, arr) {
                                    // Remove duplicates
                                    if (index + 1 >= arr.length) {
                                        return true;
                                    }

                                    return name != arr[index + 1];
                                }).join(", ");

                                throw new Error(self.contract_name + " contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of " + self._json.contract_name + ": " + unlinked_libraries);
                            }
                        }).then(function () {
                            return new Promise(function (accept, reject) {
                                var contract_class = self.web3.eth.contract(self.abi);
                                var tx_params = {};
                                var last_arg = args[args.length - 1];

                                // It's only tx_params if it's an object and not a BigNumber.
                                if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
                                    tx_params = args.pop();
                                }

                                tx_params = Utils.merge(self.class_defaults, tx_params);

                                if (tx_params.data == null) {
                                    tx_params.data = self.binary;
                                }

                                // web3 0.9.0 and above calls new this callback twice.
                                // Why, I have no idea...
                                var intermediary = function (err, web3_instance) {
                                    if (err != null) {
                                        reject(err);
                                        return;
                                    }

                                    if (err == null && web3_instance != null && web3_instance.address != null) {
                                        accept(new self(web3_instance));
                                    }
                                };

                                args.push(tx_params, intermediary);
                                contract_class.new.apply(contract_class, args);
                            });
                        });
                    },

                    at: function (address) {
                        var self = this;

                        if (address == null || typeof address != "string" || address.length != 42) {
                            throw new Error("Invalid address passed to " + this._json.contract_name + ".at(): " + address);
                        }

                        var contract = new this(address);

                        // Add thennable to allow people opt into new recommended usage.
                        contract.then = function (fn) {
                            return self.detectNetwork().then(function (network_id) {
                                var instance = new self(address);

                                return new Promise(function (accept, reject) {
                                    self.web3.eth.getCode(address, function (err, code) {
                                        if (err) return reject(err);

                                        if (!code || new BigNumber(code).eq(0)) {
                                            return reject(new Error("Cannot create instance of " + self.contract_name + "; no code at address " + address));
                                        }

                                        accept(instance);
                                    });
                                });
                            }).then(fn);
                        };

                        return contract;
                    },

                    deployed: function () {
                        var self = this;
                        var val = {}; //this.at(this.address);

                        // Add thennable to allow people to opt into new recommended usage.
                        val.then = function (fn) {
                            return self.detectNetwork().then(function () {
                                // We don't have a network config for the one we found
                                if (self._json.networks[self.network_id] == null) {
                                    throw new Error(self.contract_name + " has not been deployed to detected network (network/artifact mismatch)");
                                }

                                // If we found the network but it's not deployed
                                if (!self.isDeployed()) {
                                    throw new Error(self.contract_name + " has not been deployed to detected network (" + self.network_id + ")");
                                }

                                return new self(self.address);
                            }).then(fn);
                        };

                        return val;
                    },

                    defaults: function (class_defaults) {
                        if (this.class_defaults == null) {
                            this.class_defaults = {};
                        }

                        if (class_defaults == null) {
                            class_defaults = {};
                        }

                        var self = this;
                        Object.keys(class_defaults).forEach(function (key) {
                            var value = class_defaults[key];
                            self.class_defaults[key] = value;
                        });

                        return this.class_defaults;
                    },

                    hasNetwork: function (network_id) {
                        return this._json.networks[network_id + ""] != null;
                    },

                    isDeployed: function () {
                        if (this.network_id == null) {
                            return false;
                        }

                        if (this._json.networks[this.network_id] == null) {
                            return false;
                        }

                        return !!this.network.address;
                    },

                    detectNetwork: function () {
                        var self = this;

                        return new Promise(function (accept, reject) {
                            // Try to detect the network we have artifacts for.
                            if (self.network_id) {
                                // We have a network id and a configuration, let's go with it.
                                if (self.networks[self.network_id] != null) {
                                    return accept(self.network_id);
                                }
                            }

                            self.web3.version.getNetwork(function (err, result) {
                                if (err) return reject(err);

                                var network_id = result.toString();

                                // If we found the network via a number, let's use that.
                                if (self.hasNetwork(network_id)) {
                                    self.setNetwork(network_id);
                                    return accept();
                                }

                                // Otherwise, go through all the networks that are listed as
                                // blockchain uris and see if they match.
                                var uris = Object.keys(self._json.networks).filter(function (network) {
                                    return network.indexOf("blockchain://") == 0;
                                });

                                var matches = uris.map(function (uri) {
                                    return BlockchainUtils.matches.bind(BlockchainUtils, uri, self.web3.currentProvider);
                                });

                                Utils.parallel(matches, function (err, results) {
                                    if (err) return reject(err);

                                    for (var i = 0; i < results.length; i++) {
                                        if (results[i]) {
                                            self.setNetwork(uris[i]);
                                            return accept();
                                        }
                                    }

                                    // We found nothing. Set the network id to whatever the provider states.
                                    self.setNetwork(network_id);

                                    accept();
                                });

                            });
                        });
                    },

                    setNetwork: function (network_id) {
                        if (!network_id) return;
                        this.network_id = network_id + "";
                    },

                    // Overrides the deployed address to null.
                    // You must call this explicitly so you don't inadvertently do this otherwise.
                    resetAddress: function () {
                        delete this.network.address;
                    },

                    link: function (name, address) {
                        var self = this;

                        if (typeof name == "function") {
                            var contract = name;

                            if (contract.isDeployed() == false) {
                                throw new Error("Cannot link contract without an address.");
                            }

                            this.link(contract.contract_name, contract.address);

                            // Merge events so this contract knows about library's events
                            Object.keys(contract.events).forEach(function (topic) {
                                self.network.events[topic] = contract.events[topic];
                            });

                            return;
                        }

                        if (typeof name == "object") {
                            var obj = name;
                            Object.keys(obj).forEach(function (name) {
                                var a = obj[name];
                                self.link(name, a);
                            });
                            return;
                        }

                        if (this._json.networks[this.network_id] == null) {
                            this._json.networks[this.network_id] = {
                                events: {},
                                links: {}
                            };
                        }

                        this.network.links[name] = address;
                    },

                    clone: function (options) {
                        var self = this;
                        var temp = function TruffleContract() {
                            this.constructor = temp;
                            return Contract.apply(this, arguments);
                        };

                        var json = options;
                        var network_id;

                        if (typeof options != "object") {
                            json = self._json;
                            network_id = options;
                            options = {};
                        }

                        temp.prototype = Object.create(self.prototype);

                        temp._static_methods = this._static_methods;
                        temp._properties = this._properties;

                        temp._property_values = {};
                        temp._json = json || {};

                        Utils.bootstrap(temp);

                        temp.web3 = new Web3();
                        temp.class_defaults = temp.prototype.defaults || {};

                        if (network_id) {
                            temp.setNetwork(network_id);
                        }

                        // Copy over custom options
                        Object.keys(options).forEach(function (key) {
                            if (key.indexOf("x-") != 0) return;
                            temp[key] = options[key];
                        });

                        return temp;
                    },

                    addProp: function (key, fn) {
                        var self = this;

                        var getter = function () {
                            if (fn.get != null) {
                                return fn.get.call(self);
                            }

                            return self._property_values[key] || fn.call(self);
                        }
                        var setter = function (val) {
                            if (fn.set != null) {
                                fn.set.call(self, val);
                                return;
                            }

                            // If there's not a setter, then the property is immutable.
                            throw new Error(key + " property is immutable");
                        };

                        var definition = {};
                        definition.enumerable = false;
                        definition.configurable = false;
                        definition.get = getter;
                        definition.set = setter;

                        Object.defineProperty(this, key, definition);
                    },

                    toJSON: function () {
                        return this._json;
                    }
                };

                // Getter functions are scoped to Contract object.
                Contract._properties = {
                    contract_name: {
                        get: function () {
                            return this._json.contract_name;
                        },
                        set: function (val) {
                            this._json.contract_name = val;
                        }
                    },
                    abi: {
                        get: function () {
                            return this._json.abi;
                        },
                        set: function (val) {
                            this._json.abi = val;
                        }
                    },
                    network: function () {
                        var network_id = this.network_id;

                        if (network_id == null) {
                            throw new Error(this.contract_name + " has no network id set, cannot lookup artifact data. Either set the network manually using " + this.contract_name + ".setNetwork(), run " + this.contract_name + ".detectNetwork(), or use new(), at() or deployed() as a thenable which will detect the network automatically.");
                        }

                        // TODO: this might be bad; setting a value on a get.
                        if (this._json.networks[network_id] == null) {
                            throw new Error(this.contract_name + " has no network configuration for its current network id (" + network_id + ").");
                        }

                        return this._json.networks[network_id];
                    },
                    networks: function () {
                        return this._json.networks;
                    },
                    address: {
                        get: function () {
                            var address = this.network.address;

                            if (address == null) {
                                throw new Error("Cannot find deployed address: " + this.contract_name + " not deployed or address not set.");
                            }

                            return address;
                        },
                        set: function (val) {
                            if (val == null) {
                                throw new Error("Cannot set deployed address; malformed value: " + val);
                            }

                            var network_id = this.network_id;

                            if (network_id == null) {
                                throw new Error(this.contract_name + " has no network id set, cannot lookup artifact data. Either set the network manually using " + this.contract_name + ".setNetwork(), run " + this.contract_name + ".detectNetwork(), or use new(), at() or deployed() as a thenable which will detect the network automatically.");
                            }

                            // Create a network if we don't have one.
                            if (this._json.networks[network_id] == null) {
                                this._json.networks[network_id] = {
                                    events: {},
                                    links: {}
                                };
                            }

                            // Finally, set the address.
                            this.network.address = val;
                        }
                    },
                    links: function () {
                        if (this._json.networks[this.network_id] == null) {
                            return {};
                        }

                        return this.network.links || {};
                    },
                    events: function () {
                        // helper web3; not used for provider
                        var web3 = new Web3();

                        var events;

                        if (this._json.networks[this.network_id] == null) {
                            events = {};
                        } else {
                            events = this.network.events || {};
                        }

                        // Merge abi events with whatever's returned.
                        var abi = this.abi;

                        abi.forEach(function (item) {
                            if (item.type != "event") return;

                            var signature = item.name + "(";

                            item.inputs.forEach(function (input, index) {
                                signature += input.type;

                                if (index < item.inputs.length - 1) {
                                    signature += ",";
                                }
                            });

                            signature += ")";

                            var topic = web3.sha3(signature);

                            events[topic] = item;
                        });

                        return events;
                    },
                    binary: function () {
                        var self = this;
                        var binary = this.unlinked_binary;

                        Object.keys(this.links).forEach(function (library_name) {
                            var library_address = self.links[library_name];
                            var regex = new RegExp("__" + library_name + "_*", "g");

                            binary = binary.replace(regex, library_address.replace("0x", ""));
                        });

                        return binary;
                    },
                    unlinked_binary: {
                        get: function () {
                            return this._json.unlinked_binary;
                        },
                        set: function (val) {
                            // TODO: Ensure 0x prefix.
                            this._json.unlinked_binary = val;
                        }
                    },
                    schema_version: function () {
                        return this._json.schema_version;
                    },
                    updated_at: function () {
                        try {
                            return this.network.updated_at || this._json.updated_at;
                        } catch (e) {
                            return this._json.updated_at;
                        }
                    }
                };

                Utils.bootstrap(Contract);

                module.exports = Contract;

                return Contract;
            })(module || {});

        }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
    }, { "ethjs-abi": 7, "truffle-blockchain-utils": 15, "web3": 5 }], 2: [function (require, module, exports) {
        var Schema = require("truffle-contract-schema");
        var Contract = require("./contract.js");

        var contract = function (options) {
            options = Schema.normalizeOptions(options);
            var binary = Schema.generateBinary(options, {}, { dirty: false });

            // Note we don't use `new` here at all. This will cause the class to
            // "mutate" instead of instantiate an instance.
            return Contract.clone(binary);
        };

        // To be used to upgrade old .sol.js abstractions
        contract.fromSolJS = function (soljs_abstraction, ignore_default_network) {
            if (ignore_default_network == null) {
                ignore_default_network = false;
            }

            // Find the latest binary
            var latest_network = null;
            var latest_network_updated_at = 0;

            var networks = {};

            Object.keys(soljs_abstraction.all_networks).forEach(function (network_name) {

                if (network_name == "default") {
                    if (ignore_default_network == true) {
                        return;
                    } else {
                        throw new Error(soljs_abstraction.contract_name + " has legacy 'default' network artifacts stored within it. Generally these artifacts were a result of running Truffle on a development environment -- in order to store contracts with truffle-contract, all networks must have an identified id. If you're sure this default network represents your development environment, you can ignore processing of the default network by passing `true` as the second argument to this function. However, if you think this network represents artifacts you'd like to keep (i.e., addresses deployed to the main network), you'll need to edit your .sol.js file yourself and change the default network id to be the id of your desired network. For most people, ignoring the default network is the correct option.");
                    }
                }

                if (soljs_abstraction.all_networks[network_name].updated_at > latest_network_updated_at) {
                    latest_network = network_name;
                    latest_network_updated_at = soljs_abstraction.all_networks[network_name].updated_at;
                }

                networks[network_name] = {};

                ["address", "events", "links", "updated_at"].forEach(function (key) {
                    networks[network_name][key] = soljs_abstraction.all_networks[network_name][key];
                })
            });

            latest_network = soljs_abstraction.all_networks[latest_network] || {};

            var json = {
                contract_name: soljs_abstraction.contract_name,
                unlinked_binary: latest_network.unlinked_binary,
                abi: latest_network.abi,
                networks: networks,
                updated_at: latest_network_updated_at == 0 ? undefined : latest_network_updated_at
            };

            return contract(json);
        };

        module.exports = contract;

        if (typeof window !== "undefined") {
            window.TruffleContract = contract;
        }

    }, { "./contract.js": 1, "truffle-contract-schema": 16 }], 3: [function (require, module, exports) {
        'use strict'

        exports.byteLength = byteLength
        exports.toByteArray = toByteArray
        exports.fromByteArray = fromByteArray

        var lookup = []
        var revLookup = []
        var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

        var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        for (var i = 0, len = code.length; i < len; ++i) {
            lookup[i] = code[i]
            revLookup[code.charCodeAt(i)] = i
        }

        revLookup['-'.charCodeAt(0)] = 62
        revLookup['_'.charCodeAt(0)] = 63

        function placeHoldersCount(b64) {
            var len = b64.length
            if (len % 4 > 0) {
                throw new Error('Invalid string. Length must be a multiple of 4')
            }

            // the number of equal signs (place holders)
            // if there are two placeholders, than the two characters before it
            // represent one byte
            // if there is only one, then the three characters before it represent 2 bytes
            // this is just a cheap hack to not do indexOf twice
            return b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0
        }

        function byteLength(b64) {
            // base64 is 4/3 + up to two characters of the original data
            return b64.length * 3 / 4 - placeHoldersCount(b64)
        }

        function toByteArray(b64) {
            var i, j, l, tmp, placeHolders, arr
            var len = b64.length
            placeHolders = placeHoldersCount(b64)

            arr = new Arr(len * 3 / 4 - placeHolders)

            // if there are placeholders, only get up to the last complete 4 chars
            l = placeHolders > 0 ? len - 4 : len

            var L = 0

            for (i = 0, j = 0; i < l; i += 4, j += 3) {
                tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)]
                arr[L++] = (tmp >> 16) & 0xFF
                arr[L++] = (tmp >> 8) & 0xFF
                arr[L++] = tmp & 0xFF
            }

            if (placeHolders === 2) {
                tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4)
                arr[L++] = tmp & 0xFF
            } else if (placeHolders === 1) {
                tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2)
                arr[L++] = (tmp >> 8) & 0xFF
                arr[L++] = tmp & 0xFF
            }

            return arr
        }

        function tripletToBase64(num) {
            return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
        }

        function encodeChunk(uint8, start, end) {
            var tmp
            var output = []
            for (var i = start; i < end; i += 3) {
                tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
                output.push(tripletToBase64(tmp))
            }
            return output.join('')
        }

        function fromByteArray(uint8) {
            var tmp
            var len = uint8.length
            var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
            var output = ''
            var parts = []
            var maxChunkLength = 16383 // must be multiple of 3

            // go through the array every three bytes, we'll deal with trailing stuff later
            for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
                parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
            }

            // pad the end with zeros, but make sure to not forget the extra bytes
            if (extraBytes === 1) {
                tmp = uint8[len - 1]
                output += lookup[tmp >> 2]
                output += lookup[(tmp << 4) & 0x3F]
                output += '=='
            } else if (extraBytes === 2) {
                tmp = (uint8[len - 2] << 8) + (uint8[len - 1])
                output += lookup[tmp >> 10]
                output += lookup[(tmp >> 4) & 0x3F]
                output += lookup[(tmp << 2) & 0x3F]
                output += '='
            }

            parts.push(output)

            return parts.join('')
        }

    }, {}], 4: [function (require, module, exports) {
        (function (module, exports) {
            'use strict';

            // Utils
            function assert(val, msg) {
                if (!val) throw new Error(msg || 'Assertion failed');
            }

            // Could use `inherits` module, but don't want to move from single file
            // architecture yet.
            function inherits(ctor, superCtor) {
                ctor.super_ = superCtor;
                var TempCtor = function () { };
                TempCtor.prototype = superCtor.prototype;
                ctor.prototype = new TempCtor();
                ctor.prototype.constructor = ctor;
            }

            // BN

            function BN(number, base, endian) {
                if (BN.isBN(number)) {
                    return number;
                }

                this.negative = 0;
                this.words = null;
                this.length = 0;

                // Reduction context
                this.red = null;

                if (number !== null) {
                    if (base === 'le' || base === 'be') {
                        endian = base;
                        base = 10;
                    }

                    this._init(number || 0, base || 10, endian || 'be');
                }
            }
            if (typeof module === 'object') {
                module.exports = BN;
            } else {
                exports.BN = BN;
            }

            BN.BN = BN;
            BN.wordSize = 26;

            var Buffer;
            try {
                Buffer = require('buf' + 'fer').Buffer;
            } catch (e) {
            }

            BN.isBN = function isBN(num) {
                if (num instanceof BN) {
                    return true;
                }

                return num !== null && typeof num === 'object' &&
                    num.constructor.wordSize === BN.wordSize && Array.isArray(num.words);
            };

            BN.max = function max(left, right) {
                if (left.cmp(right) > 0) return left;
                return right;
            };

            BN.min = function min(left, right) {
                if (left.cmp(right) < 0) return left;
                return right;
            };

            BN.prototype._init = function init(number, base, endian) {
                if (typeof number === 'number') {
                    return this._initNumber(number, base, endian);
                }

                if (typeof number === 'object') {
                    return this._initArray(number, base, endian);
                }

                if (base === 'hex') {
                    base = 16;
                }
                assert(base === (base | 0) && base >= 2 && base <= 36);

                number = number.toString().replace(/\s+/g, '');
                var start = 0;
                if (number[0] === '-') {
                    start++;
                }

                if (base === 16) {
                    this._parseHex(number, start);
                } else {
                    this._parseBase(number, base, start);
                }

                if (number[0] === '-') {
                    this.negative = 1;
                }

                this.strip();

                if (endian !== 'le') return;

                this._initArray(this.toArray(), base, endian);
            };

            BN.prototype._initNumber = function _initNumber(number, base, endian) {
                if (number < 0) {
                    this.negative = 1;
                    number = -number;
                }
                if (number < 0x4000000) {
                    this.words = [number & 0x3ffffff];
                    this.length = 1;
                } else if (number < 0x10000000000000) {
                    this.words = [
                        number & 0x3ffffff,
                        (number / 0x4000000) & 0x3ffffff
                    ];
                    this.length = 2;
                } else {
                    assert(number < 0x20000000000000); // 2 ^ 53 (unsafe)
                    this.words = [
                        number & 0x3ffffff,
                        (number / 0x4000000) & 0x3ffffff,
                        1
                    ];
                    this.length = 3;
                }

                if (endian !== 'le') return;

                // Reverse the bytes
                this._initArray(this.toArray(), base, endian);
            };

            BN.prototype._initArray = function _initArray(number, base, endian) {
                // Perhaps a Uint8Array
                assert(typeof number.length === 'number');
                if (number.length <= 0) {
                    this.words = [0];
                    this.length = 1;
                    return this;
                }

                this.length = Math.ceil(number.length / 3);
                this.words = new Array(this.length);
                for (var i = 0; i < this.length; i++) {
                    this.words[i] = 0;
                }

                var j, w;
                var off = 0;
                if (endian === 'be') {
                    for (i = number.length - 1, j = 0; i >= 0; i -= 3) {
                        w = number[i] | (number[i - 1] << 8) | (number[i - 2] << 16);
                        this.words[j] |= (w << off) & 0x3ffffff;
                        this.words[j + 1] = (w >>> (26 - off)) & 0x3ffffff;
                        off += 24;
                        if (off >= 26) {
                            off -= 26;
                            j++;
                        }
                    }
                } else if (endian === 'le') {
                    for (i = 0, j = 0; i < number.length; i += 3) {
                        w = number[i] | (number[i + 1] << 8) | (number[i + 2] << 16);
                        this.words[j] |= (w << off) & 0x3ffffff;
                        this.words[j + 1] = (w >>> (26 - off)) & 0x3ffffff;
                        off += 24;
                        if (off >= 26) {
                            off -= 26;
                            j++;
                        }
                    }
                }
                return this.strip();
            };

            function parseHex(str, start, end) {
                var r = 0;
                var len = Math.min(str.length, end);
                for (var i = start; i < len; i++) {
                    var c = str.charCodeAt(i) - 48;

                    r <<= 4;

                    // 'a' - 'f'
                    if (c >= 49 && c <= 54) {
                        r |= c - 49 + 0xa;

                        // 'A' - 'F'
                    } else if (c >= 17 && c <= 22) {
                        r |= c - 17 + 0xa;

                        // '0' - '9'
                    } else {
                        r |= c & 0xf;
                    }
                }
                return r;
            }

            BN.prototype._parseHex = function _parseHex(number, start) {
                // Create possibly bigger array to ensure that it fits the number
                this.length = Math.ceil((number.length - start) / 6);
                this.words = new Array(this.length);
                for (var i = 0; i < this.length; i++) {
                    this.words[i] = 0;
                }

                var j, w;
                // Scan 24-bit chunks and add them to the number
                var off = 0;
                for (i = number.length - 6, j = 0; i >= start; i -= 6) {
                    w = parseHex(number, i, i + 6);
                    this.words[j] |= (w << off) & 0x3ffffff;
                    // NOTE: `0x3fffff` is intentional here, 26bits max shift + 24bit hex limb
                    this.words[j + 1] |= w >>> (26 - off) & 0x3fffff;
                    off += 24;
                    if (off >= 26) {
                        off -= 26;
                        j++;
                    }
                }
                if (i + 6 !== start) {
                    w = parseHex(number, start, i + 6);
                    this.words[j] |= (w << off) & 0x3ffffff;
                    this.words[j + 1] |= w >>> (26 - off) & 0x3fffff;
                }
                this.strip();
            };

            function parseBase(str, start, end, mul) {
                var r = 0;
                var len = Math.min(str.length, end);
                for (var i = start; i < len; i++) {
                    var c = str.charCodeAt(i) - 48;

                    r *= mul;

                    // 'a'
                    if (c >= 49) {
                        r += c - 49 + 0xa;

                        // 'A'
                    } else if (c >= 17) {
                        r += c - 17 + 0xa;

                        // '0' - '9'
                    } else {
                        r += c;
                    }
                }
                return r;
            }

            BN.prototype._parseBase = function _parseBase(number, base, start) {
                // Initialize as zero
                this.words = [0];
                this.length = 1;

                // Find length of limb in base
                for (var limbLen = 0, limbPow = 1; limbPow <= 0x3ffffff; limbPow *= base) {
                    limbLen++;
                }
                limbLen--;
                limbPow = (limbPow / base) | 0;

                var total = number.length - start;
                var mod = total % limbLen;
                var end = Math.min(total, total - mod) + start;

                var word = 0;
                for (var i = start; i < end; i += limbLen) {
                    word = parseBase(number, i, i + limbLen, base);

                    this.imuln(limbPow);
                    if (this.words[0] + word < 0x4000000) {
                        this.words[0] += word;
                    } else {
                        this._iaddn(word);
                    }
                }

                if (mod !== 0) {
                    var pow = 1;
                    word = parseBase(number, i, number.length, base);

                    for (i = 0; i < mod; i++) {
                        pow *= base;
                    }

                    this.imuln(pow);
                    if (this.words[0] + word < 0x4000000) {
                        this.words[0] += word;
                    } else {
                        this._iaddn(word);
                    }
                }
            };

            BN.prototype.copy = function copy(dest) {
                dest.words = new Array(this.length);
                for (var i = 0; i < this.length; i++) {
                    dest.words[i] = this.words[i];
                }
                dest.length = this.length;
                dest.negative = this.negative;
                dest.red = this.red;
            };


            BN.prototype.clone = function clone() {
                var r = new BN(null);
                this.copy(r);
                return r;
            };

            BN.prototype._expand = function _expand(size) {
                while (this.length < size) {
                    this.words[this.length++] = 0;
                }
                return this;
            };

            // Remove leading `0` from `this`
            BN.prototype.strip = function strip() {
                while (this.length > 1 && this.words[this.length - 1] === 0) {
                    this.length--;
                }
                return this._normSign();
            };

            BN.prototype._normSign = function _normSign() {
                // -0 = 0
                if (this.length === 1 && this.words[0] === 0) {
                    this.negative = 0;
                }
                return this;
            };

            BN.prototype.inspect = function inspect() {
                return (this.red ? '<BN-R: ' : '<BN: ') + this.toString(16) + '>';
            };

            /*
            var zeros = [];
            var groupSizes = [];
            var groupBases = [];
            var s = '';
            var i = -1;
            while (++i < BN.wordSize) {
              zeros[i] = s;
              s += '0';
            }
            groupSizes[0] = 0;
            groupSizes[1] = 0;
            groupBases[0] = 0;
            groupBases[1] = 0;
            var base = 2 - 1;
            while (++base < 36 + 1) {
              var groupSize = 0;
              var groupBase = 1;
              while (groupBase < (1 << BN.wordSize) / base) {
                groupBase *= base;
                groupSize += 1;
              }
              groupSizes[base] = groupSize;
              groupBases[base] = groupBase;
            }
            */

            var zeros = [
                '',
                '0',
                '00',
                '000',
                '0000',
                '00000',
                '000000',
                '0000000',
                '00000000',
                '000000000',
                '0000000000',
                '00000000000',
                '000000000000',
                '0000000000000',
                '00000000000000',
                '000000000000000',
                '0000000000000000',
                '00000000000000000',
                '000000000000000000',
                '0000000000000000000',
                '00000000000000000000',
                '000000000000000000000',
                '0000000000000000000000',
                '00000000000000000000000',
                '000000000000000000000000',
                '0000000000000000000000000'
            ];

            var groupSizes = [
                0, 0,
                25, 16, 12, 11, 10, 9, 8,
                8, 7, 7, 7, 7, 6, 6,
                6, 6, 6, 6, 6, 5, 5,
                5, 5, 5, 5, 5, 5, 5,
                5, 5, 5, 5, 5, 5, 5
            ];

            var groupBases = [
                0, 0,
                33554432, 43046721, 16777216, 48828125, 60466176, 40353607, 16777216,
                43046721, 10000000, 19487171, 35831808, 62748517, 7529536, 11390625,
                16777216, 24137569, 34012224, 47045881, 64000000, 4084101, 5153632,
                6436343, 7962624, 9765625, 11881376, 14348907, 17210368, 20511149,
                24300000, 28629151, 33554432, 39135393, 45435424, 52521875, 60466176
            ];

            BN.prototype.toString = function toString(base, padding) {
                base = base || 10;
                padding = padding | 0 || 1;

                var out;
                if (base === 16 || base === 'hex') {
                    out = '';
                    var off = 0;
                    var carry = 0;
                    for (var i = 0; i < this.length; i++) {
                        var w = this.words[i];
                        var word = (((w << off) | carry) & 0xffffff).toString(16);
                        carry = (w >>> (24 - off)) & 0xffffff;
                        if (carry !== 0 || i !== this.length - 1) {
                            out = zeros[6 - word.length] + word + out;
                        } else {
                            out = word + out;
                        }
                        off += 2;
                        if (off >= 26) {
                            off -= 26;
                            i--;
                        }
                    }
                    if (carry !== 0) {
                        out = carry.toString(16) + out;
                    }
                    while (out.length % padding !== 0) {
                        out = '0' + out;
                    }
                    if (this.negative !== 0) {
                        out = '-' + out;
                    }
                    return out;
                }

                if (base === (base | 0) && base >= 2 && base <= 36) {
                    // var groupSize = Math.floor(BN.wordSize * Math.LN2 / Math.log(base));
                    var groupSize = groupSizes[base];
                    // var groupBase = Math.pow(base, groupSize);
                    var groupBase = groupBases[base];
                    out = '';
                    var c = this.clone();
                    c.negative = 0;
                    while (!c.isZero()) {
                        var r = c.modn(groupBase).toString(base);
                        c = c.idivn(groupBase);

                        if (!c.isZero()) {
                            out = zeros[groupSize - r.length] + r + out;
                        } else {
                            out = r + out;
                        }
                    }
                    if (this.isZero()) {
                        out = '0' + out;
                    }
                    while (out.length % padding !== 0) {
                        out = '0' + out;
                    }
                    if (this.negative !== 0) {
                        out = '-' + out;
                    }
                    return out;
                }

                assert(false, 'Base should be between 2 and 36');
            };

            BN.prototype.toNumber = function toNumber() {
                var ret = this.words[0];
                if (this.length === 2) {
                    ret += this.words[1] * 0x4000000;
                } else if (this.length === 3 && this.words[2] === 0x01) {
                    // NOTE: at this stage it is known that the top bit is set
                    ret += 0x10000000000000 + (this.words[1] * 0x4000000);
                } else if (this.length > 2) {
                    assert(false, 'Number can only safely store up to 53 bits');
                }
                return (this.negative !== 0) ? -ret : ret;
            };

            BN.prototype.toJSON = function toJSON() {
                return this.toString(16);
            };

            BN.prototype.toBuffer = function toBuffer(endian, length) {
                assert(typeof Buffer !== 'undefined');
                return this.toArrayLike(Buffer, endian, length);
            };

            BN.prototype.toArray = function toArray(endian, length) {
                return this.toArrayLike(Array, endian, length);
            };

            BN.prototype.toArrayLike = function toArrayLike(ArrayType, endian, length) {
                var byteLength = this.byteLength();
                var reqLength = length || Math.max(1, byteLength);
                assert(byteLength <= reqLength, 'byte array longer than desired length');
                assert(reqLength > 0, 'Requested array length <= 0');

                this.strip();
                var littleEndian = endian === 'le';
                var res = new ArrayType(reqLength);

                var b, i;
                var q = this.clone();
                if (!littleEndian) {
                    // Assume big-endian
                    for (i = 0; i < reqLength - byteLength; i++) {
                        res[i] = 0;
                    }

                    for (i = 0; !q.isZero(); i++) {
                        b = q.andln(0xff);
                        q.iushrn(8);

                        res[reqLength - i - 1] = b;
                    }
                } else {
                    for (i = 0; !q.isZero(); i++) {
                        b = q.andln(0xff);
                        q.iushrn(8);

                        res[i] = b;
                    }

                    for (; i < reqLength; i++) {
                        res[i] = 0;
                    }
                }

                return res;
            };

            if (Math.clz32) {
                BN.prototype._countBits = function _countBits(w) {
                    return 32 - Math.clz32(w);
                };
            } else {
                BN.prototype._countBits = function _countBits(w) {
                    var t = w;
                    var r = 0;
                    if (t >= 0x1000) {
                        r += 13;
                        t >>>= 13;
                    }
                    if (t >= 0x40) {
                        r += 7;
                        t >>>= 7;
                    }
                    if (t >= 0x8) {
                        r += 4;
                        t >>>= 4;
                    }
                    if (t >= 0x02) {
                        r += 2;
                        t >>>= 2;
                    }
                    return r + t;
                };
            }

            BN.prototype._zeroBits = function _zeroBits(w) {
                // Short-cut
                if (w === 0) return 26;

                var t = w;
                var r = 0;
                if ((t & 0x1fff) === 0) {
                    r += 13;
                    t >>>= 13;
                }
                if ((t & 0x7f) === 0) {
                    r += 7;
                    t >>>= 7;
                }
                if ((t & 0xf) === 0) {
                    r += 4;
                    t >>>= 4;
                }
                if ((t & 0x3) === 0) {
                    r += 2;
                    t >>>= 2;
                }
                if ((t & 0x1) === 0) {
                    r++;
                }
                return r;
            };

            // Return number of used bits in a BN
            BN.prototype.bitLength = function bitLength() {
                var w = this.words[this.length - 1];
                var hi = this._countBits(w);
                return (this.length - 1) * 26 + hi;
            };

            function toBitArray(num) {
                var w = new Array(num.bitLength());

                for (var bit = 0; bit < w.length; bit++) {
                    var off = (bit / 26) | 0;
                    var wbit = bit % 26;

                    w[bit] = (num.words[off] & (1 << wbit)) >>> wbit;
                }

                return w;
            }

            // Number of trailing zero bits
            BN.prototype.zeroBits = function zeroBits() {
                if (this.isZero()) return 0;

                var r = 0;
                for (var i = 0; i < this.length; i++) {
                    var b = this._zeroBits(this.words[i]);
                    r += b;
                    if (b !== 26) break;
                }
                return r;
            };

            BN.prototype.byteLength = function byteLength() {
                return Math.ceil(this.bitLength() / 8);
            };

            BN.prototype.toTwos = function toTwos(width) {
                if (this.negative !== 0) {
                    return this.abs().inotn(width).iaddn(1);
                }
                return this.clone();
            };

            BN.prototype.fromTwos = function fromTwos(width) {
                if (this.testn(width - 1)) {
                    return this.notn(width).iaddn(1).ineg();
                }
                return this.clone();
            };

            BN.prototype.isNeg = function isNeg() {
                return this.negative !== 0;
            };

            // Return negative clone of `this`
            BN.prototype.neg = function neg() {
                return this.clone().ineg();
            };

            BN.prototype.ineg = function ineg() {
                if (!this.isZero()) {
                    this.negative ^= 1;
                }

                return this;
            };

            // Or `num` with `this` in-place
            BN.prototype.iuor = function iuor(num) {
                while (this.length < num.length) {
                    this.words[this.length++] = 0;
                }

                for (var i = 0; i < num.length; i++) {
                    this.words[i] = this.words[i] | num.words[i];
                }

                return this.strip();
            };

            BN.prototype.ior = function ior(num) {
                assert((this.negative | num.negative) === 0);
                return this.iuor(num);
            };

            // Or `num` with `this`
            BN.prototype.or = function or(num) {
                if (this.length > num.length) return this.clone().ior(num);
                return num.clone().ior(this);
            };

            BN.prototype.uor = function uor(num) {
                if (this.length > num.length) return this.clone().iuor(num);
                return num.clone().iuor(this);
            };

            // And `num` with `this` in-place
            BN.prototype.iuand = function iuand(num) {
                // b = min-length(num, this)
                var b;
                if (this.length > num.length) {
                    b = num;
                } else {
                    b = this;
                }

                BN.prototype.clone = function clone() {
                    var r = new BN(null);
                    this.copy(r);
                    return r;
                };

                BN.prototype._expand = function _expand(size) {
                    while (this.length < size) {
                        this.words[this.length++] = 0;
                    }
                    return this;
                };

                // Remove leading `0` from `this`
                BN.prototype.strip = function strip() {
                    while (this.length > 1 && this.words[this.length - 1] === 0) {
                        this.length--;
                    }
                    return this._normSign();
                };

                BN.prototype._normSign = function _normSign() {
                    // -0 = 0
                    if (this.length === 1 && this.words[0] === 0) {
                        this.negative = 0;
                    }
                    return this;
                };

                BN.prototype.inspect = function inspect() {
                    return (this.red ? '<BN-R: ' : '<BN: ') + this.toString(16) + '>';
                };

                /*
                var zeros = [];
                var groupSizes = [];
                var groupBases = [];
                var s = '';
                var i = -1;
                while (++i < BN.wordSize) {
                  zeros[i] = s;
                  s += '0';
                }
                groupSizes[0] = 0;
                groupSizes[1] = 0;
                groupBases[0] = 0;
                groupBases[1] = 0;
                var base = 2 - 1;
                while (++base < 36 + 1) {
                  var groupSize = 0;
                  var groupBase = 1;
                  while (groupBase < (1 << BN.wordSize) / base) {
                    groupBase *= base;
                    groupSize += 1;
                  }
                  groupSizes[base] = groupSize;
                  groupBases[base] = groupBase;
                }
                */

                var zeros = [
                    '',
                    '0',
                    '00',
                    '000',
                    '0000',
                    '00000',
                    '000000',
                    '0000000',
                    '00000000',
                    '000000000',
                    '0000000000',
                    '00000000000',
                    '000000000000',
                    '0000000000000',
                    '00000000000000',
                    '000000000000000',
                    '0000000000000000',
                    '00000000000000000',
                    '000000000000000000',
                    '0000000000000000000',
                    '00000000000000000000',
                    '000000000000000000000',
                    '0000000000000000000000',
                    '00000000000000000000000',
                    '000000000000000000000000',
                    '0000000000000000000000000'
                ];

                var groupSizes = [
                    0, 0,
                    25, 16, 12, 11, 10, 9, 8,
                    8, 7, 7, 7, 7, 6, 6,
                    6, 6, 6, 6, 6, 5, 5,
                    5, 5, 5, 5, 5, 5, 5,
                    5, 5, 5, 5, 5, 5, 5
                ];

                var groupBases = [
                    0, 0,
                    33554432, 43046721, 16777216, 48828125, 60466176, 40353607, 16777216,
                    43046721, 10000000, 19487171, 35831808, 62748517, 7529536, 11390625,
                    16777216, 24137569, 34012224, 47045881, 64000000, 4084101, 5153632,
                    6436343, 7962624, 9765625, 11881376, 14348907, 17210368, 20511149,
                    24300000, 28629151, 33554432, 39135393, 45435424, 52521875, 60466176
                ];

                BN.prototype.toString = function toString(base, padding) {
                    base = base || 10;
                    padding = padding | 0 || 1;

                    var out;
                    if (base === 16 || base === 'hex') {
                        out = '';
                        var off = 0;
                        var carry = 0;
                        for (var i = 0; i < this.length; i++) {
                            var w = this.words[i];
                            var word = (((w << off) | carry) & 0xffffff).toString(16);
                            carry = (w >>> (24 - off)) & 0xffffff;
                            if (carry !== 0 || i !== this.length - 1) {
                                out = zeros[6 - word.length] + word + out;
                            } else {
                                out = word + out;
                            }
                            off += 2;
                            if (off >= 26) {
                                off -= 26;
                                i--;
                            }
                        }
                        if (carry !== 0) {
                            out = carry.toString(16) + out;
                        }
                        while (out.length % padding !== 0) {
                            out = '0' + out;
                        }
                        if (this.negative !== 0) {
                            out = '-' + out;
                        }
                        return out;
                    }

                    if (base === (base | 0) && base >= 2 && base <= 36) {
                        // var groupSize = Math.floor(BN.wordSize * Math.LN2 / Math.log(base));
                        var groupSize = groupSizes[base];
                        // var groupBase = Math.pow(base, groupSize);
                        var groupBase = groupBases[base];
                        out = '';
                        var c = this.clone();
                        c.negative = 0;
                        while (!c.isZero()) {
                            var r = c.modn(groupBase).toString(base);
                            c = c.idivn(groupBase);

                            if (!c.isZero()) {
                                out = zeros[groupSize - r.length] + r + out;
                            } else {
                                out = r + out;
                            }
                        }
                        if (this.isZero()) {
                            out = '0' + out;
                        }
                        while (out.length % padding !== 0) {
                            out = '0' + out;
                        }
                        if (this.negative !== 0) {
                            out = '-' + out;
                        }
                        return out;
                    }

                    assert(false, 'Base should be between 2 and 36');
                };

                BN.prototype.toNumber = function toNumber() {
                    var ret = this.words[0];
                    if (this.length === 2) {
                        ret += this.words[1] * 0x4000000;
                    } else if (this.length === 3 && this.words[2] === 0x01) {
                        // NOTE: at this stage it is known that the top bit is set
                        ret += 0x10000000000000 + (this.words[1] * 0x4000000);
                    } else if (this.length > 2) {
                        assert(false, 'Number can only safely store up to 53 bits');
                    }
                    return (this.negative !== 0) ? -ret : ret;
                };

                BN.prototype.toJSON = function toJSON() {
                    return this.toString(16);
                };

                BN.prototype.toBuffer = function toBuffer(endian, length) {
                    assert(typeof Buffer !== 'undefined');
                    return this.toArrayLike(Buffer, endian, length);
                };

                BN.prototype.toArray = function toArray(endian, length) {
                    return this.toArrayLike(Array, endian, length);
                };

                BN.prototype.toArrayLike = function toArrayLike(ArrayType, endian, length) {
                    var byteLength = this.byteLength();
                    var reqLength = length || Math.max(1, byteLength);
                    assert(byteLength <= reqLength, 'byte array longer than desired length');
                    assert(reqLength > 0, 'Requested array length <= 0');

                    this.strip();
                    var littleEndian = endian === 'le';
                    var res = new ArrayType(reqLength);

                    var b, i;
                    var q = this.clone();
                    if (!littleEndian) {
                        // Assume big-endian
                        for (i = 0; i < reqLength - byteLength; i++) {
                            res[i] = 0;
                        }

                        for (i = 0; !q.isZero(); i++) {
                            b = q.andln(0xff);
                            q.iushrn(8);

                            res[reqLength - i - 1] = b;
                        }
                    } else {
                        for (i = 0; !q.isZero(); i++) {
                            b = q.andln(0xff);
                            q.iushrn(8);

                            res[i] = b;
                        }

                        for (; i < reqLength; i++) {
                            res[i] = 0;
                        }
                    }

                    return res;
                };

                if (Math.clz32) {
                    BN.prototype._countBits = function _countBits(w) {
                        return 32 - Math.clz32(w);
                    };
                } else {
                    BN.prototype._countBits = function _countBits(w) {
                        var t = w;
                        var r = 0;
                        if (t >= 0x1000) {
                            r += 13;
                            t >>>= 13;
                        }
                        if (t >= 0x40) {
                            r += 7;
                            t >>>= 7;
                        }
                        if (t >= 0x8) {
                            r += 4;
                            t >>>= 4;
                        }
                        if (t >= 0x02) {
                            r += 2;
                            t >>>= 2;
                        }
                        return r + t;
                    };
                }

                BN.prototype._zeroBits = function _zeroBits(w) {
                    // Short-cut
                    if (w === 0) return 26;

                    var t = w;
                    var r = 0;
                    if ((t & 0x1fff) === 0) {
                        r += 13;
                        t >>>= 13;
                    }
                    if ((t & 0x7f) === 0) {
                        r += 7;
                        t >>>= 7;
                    }
                    if ((t & 0xf) === 0) {
                        r += 4;
                        t >>>= 4;
                    }
                    if ((t & 0x3) === 0) {
                        r += 2;
                        t >>>= 2;
                    }
                    if ((t & 0x1) === 0) {
                        r++;
                    }
                    return r;
                };

                // Return number of used bits in a BN
                BN.prototype.bitLength = function bitLength() {
                    var w = this.words[this.length - 1];
                    var hi = this._countBits(w);
                    return (this.length - 1) * 26 + hi;
                };

                function toBitArray(num) {
                    var w = new Array(num.bitLength());

                    for (var bit = 0; bit < w.length; bit++) {
                        var off = (bit / 26) | 0;
                        var wbit = bit % 26;

                        w[bit] = (num.words[off] & (1 << wbit)) >>> wbit;
                    }

                    return w;
                }

                // Number of trailing zero bits
                BN.prototype.zeroBits = function zeroBits() {
                    if (this.isZero()) return 0;

                    var r = 0;
                    for (var i = 0; i < this.length; i++) {
                        var b = this._zeroBits(this.words[i]);
                        r += b;
                        if (b !== 26) break;
                    }
                    return r;
                };

                BN.prototype.byteLength = function byteLength() {
                    return Math.ceil(this.bitLength() / 8);
                };

                BN.prototype.toTwos = function toTwos(width) {
                    if (this.negative !== 0) {
                        return this.abs().inotn(width).iaddn(1);
                    }
                    return this.clone();
                };

                BN.prototype.fromTwos = function fromTwos(width) {
                    if (this.testn(width - 1)) {
                        return this.notn(width).iaddn(1).ineg();
                    }
                    return this.clone();
                };

                BN.prototype.isNeg = function isNeg() {
                    return this.negative !== 0;
                };

                // Return negative clone of `this`
                BN.prototype.neg = function neg() {
                    return this.clone().ineg();
                };

                BN.prototype.ineg = function ineg() {
                    if (!this.isZero()) {
                        this.negative ^= 1;
                    }

                    return this;
                };

                // Or `num` with `this` in-place
                BN.prototype.iuor = function iuor(num) {
                    while (this.length < num.length) {
                        this.words[this.length++] = 0;
                    }

                    for (var i = 0; i < num.length; i++) {
                        this.words[i] = this.words[i] | num.words[i];
                    }

                    return this.strip();
                };

                BN.prototype.ior = function ior(num) {
                    assert((this.negative | num.negative) === 0);
                    return this.iuor(num);
                };

                // Or `num` with `this`
                BN.prototype.or = function or(num) {
                    if (this.length > num.length) return this.clone().ior(num);
                    return num.clone().ior(this);
                };

                BN.prototype.uor = function uor(num) {
                    if (this.length > num.length) return this.clone().iuor(num);
                    return num.clone().iuor(this);
                };

                // And `num` with `this` in-place
                BN.prototype.iuand = function iuand(num) {
                    // b = min-length(num, this)
                    var b;
                    if (this.length > num.length) {
                        b = num;
                    } else {
                        b = this;
                    }

                    // Remove processed words
                    var processedWords = dataWords.splice(0, nWordsReady);
                    data.sigBytes -= nBytesReady;
                }

                // Return processed words
                return new WordArray.init(processedWords, nBytesReady);
            },

                /**
                 * Creates a copy of this object.
                 *
                 * @return {Object} The clone.
                 *
                 * @example
                 *
                 *     var clone = bufferedBlockAlgorithm.clone();
                 */
                clone: function () {
                    var clone = Base.clone.call(this);
                    clone._data = this._data.clone();

                    return clone;
                },

            _minBufferSize: 0
    });

/**
 * Abstract hasher template.
 *
 * @property {number} blockSize The number of 32-bit words this hasher operates on. Default: 16 (512 bits)
 */
var Hasher = C_lib.Hasher = BufferedBlockAlgorithm.extend({
    /**
     * Configuration options.
     */
    cfg: Base.extend(),

    /**
     * Initializes a newly created hasher.
     *
     * @param {Object} cfg (Optional) The configuration options to use for this hash computation.
     *
     * @example
     *
     *     var hasher = CryptoJS.algo.SHA256.create();
     */
    init: function (cfg) {
        // Apply config defaults
        this.cfg = this.cfg.extend(cfg);

        // Set initial values
        this.reset();
    },

    /**
     * Resets this hasher to its initial state.
     *
     * @example
     *
     *     hasher.reset();
     */
    reset: function () {
        // Reset data buffer
        BufferedBlockAlgorithm.reset.call(this);

        // Perform concrete-hasher logic
        this._doReset();
    },

    /**
     * Updates this hasher with a message.
     *
     * @param {WordArray|string} messageUpdate The message to append.
     *
     * @return {Hasher} This hasher.
     *
     * @example
     *
     *     hasher.update('message');
     *     hasher.update(wordArray);
     */
    update: function (messageUpdate) {
        // Append
        this._append(messageUpdate);

        // Update the hash
        this._process();

        // Chainable
        return this;
    },

    /**
     * Finalizes the hash computation.
     * Note that the finalize operation is effectively a destructive, read-once operation.
     *
     * @param {WordArray|string} messageUpdate (Optional) A final message update.
     *
     * @return {WordArray} The hash.
     *
     * @example
     *
     *     var hash = hasher.finalize();
     *     var hash = hasher.finalize('message');
     *     var hash = hasher.finalize(wordArray);
     */
    finalize: function (messageUpdate) {
        // Final message update
        if (messageUpdate) {
            this._append(messageUpdate);
        }

        // Perform concrete-hasher logic
        var hash = this._doFinalize();

        return hash;
    },

    blockSize: 512 / 32,

    /**
     * Creates a shortcut function to a hasher's object interface.
     *
     * @param {Hasher} hasher The hasher to create a helper for.
     *
     * @return {Function} The shortcut function.
     *
     * @static
     *
     * @example
     *
     *     var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
     */
    _createHelper: function (hasher) {
        return function (message, cfg) {
            return new hasher.init(cfg).finalize(message);
        };
    },

    /**
     * Creates a shortcut function to the HMAC's object interface.
     *
     * @param {Hasher} hasher The hasher to use in this HMAC helper.
     *
     * @return {Function} The shortcut function.
     *
     * @static
     *
     * @example
     *
     *     var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
     */
    _createHmacHelper: function (hasher) {
        return function (message, key) {
            return new C_algo.HMAC.init(hasher, key).finalize(message);
        };
    }
});

/**
 * Algorithm namespace.
 */
var C_algo = C.algo = {};

return C;
	}(Math));


return CryptoJS;

}));
}, { }], 18: [function (require, module, exports) {
    ; (function (root, factory, undef) {
        if (typeof exports === "object") {
            // CommonJS
            module.exports = exports = factory(require("./core"), require("./x64-core"));
        }
        else if (typeof define === "function" && define.amd) {
            // AMD
            define(["./core", "./x64-core"], factory);
        }
        else {
            // Global (browser)
            factory(root.CryptoJS);
        }
    }(this, function (CryptoJS) {

        (function (Math) {
            // Shortcuts
            var C = CryptoJS;
            var C_lib = C.lib;
            var WordArray = C_lib.WordArray;
            var Hasher = C_lib.Hasher;
            var C_x64 = C.x64;
            var X64Word = C_x64.Word;
            var C_algo = C.algo;

            // Constants tables
            var RHO_OFFSETS = [];
            var PI_INDEXES = [];
            var ROUND_CONSTANTS = [];

            // Compute Constants
            (function () {
                // Compute rho offset constants
                var x = 1, y = 0;
                for (var t = 0; t < 24; t++) {
                    RHO_OFFSETS[x + 5 * y] = ((t + 1) * (t + 2) / 2) % 64;

                    var newX = y % 5;
                    var newY = (2 * x + 3 * y) % 5;
                    x = newX;
                    y = newY;
                }

                // Compute pi index constants
                for (var x = 0; x < 5; x++) {
                    for (var y = 0; y < 5; y++) {
                        PI_INDEXES[x + 5 * y] = y + ((2 * x + 3 * y) % 5) * 5;
                    }
                }

                // Compute round constants
                var LFSR = 0x01;
                for (var i = 0; i < 24; i++) {
                    var roundConstantMsw = 0;
                    var roundConstantLsw = 0;

                    for (var j = 0; j < 7; j++) {
                        if (LFSR & 0x01) {
                            var bitPosition = (1 << j) - 1;
                            if (bitPosition < 32) {
                                roundConstantLsw ^= 1 << bitPosition;
                            } else /* if (bitPosition >= 32) */ {
                                roundConstantMsw ^= 1 << (bitPosition - 32);
                            }
                        }

                        // Compute next LFSR
                        if (LFSR & 0x80) {
                            // Primitive polynomial over GF(2): x^8 + x^6 + x^5 + x^4 + 1
                            LFSR = (LFSR << 1) ^ 0x71;
                        } else {
                            LFSR <<= 1;
                        }
                    }

                    ROUND_CONSTANTS[i] = X64Word.create(roundConstantMsw, roundConstantLsw);
                }
            }());

            // Reusable objects for temporary values
            var T = [];
            (function () {
                for (var i = 0; i < 25; i++) {
                    T[i] = X64Word.create();
                }
            }());

            /**
             * SHA-3 hash algorithm.
             */
            var SHA3 = C_algo.SHA3 = Hasher.extend({
                /**
                 * Configuration options.
                 *
                 * @property {number} outputLength
                 *   The desired number of bits in the output hash.
                 *   Only values permitted are: 224, 256, 384, 512.
                 *   Default: 512
                 */
                cfg: Hasher.cfg.extend({
                    outputLength: 512
                }),

                _doReset: function () {
                    var state = this._state = []
                    for (var i = 0; i < 25; i++) {
                        state[i] = new X64Word.init();
                    }

                    this.blockSize = (1600 - 2 * this.cfg.outputLength) / 32;
                },

                _doProcessBlock: function (M, offset) {
                    // Shortcuts
                    var state = this._state;
                    var nBlockSizeLanes = this.blockSize / 2;

                    // Absorb
                    for (var i = 0; i < nBlockSizeLanes; i++) {
                        // Shortcuts
                        var M2i = M[offset + 2 * i];
                        var M2i1 = M[offset + 2 * i + 1];

                        // Swap endian
                        M2i = (
                            (((M2i << 8) | (M2i >>> 24)) & 0x00ff00ff) |
                            (((M2i << 24) | (M2i >>> 8)) & 0xff00ff00)
                        );
                        M2i1 = (
                            (((M2i1 << 8) | (M2i1 >>> 24)) & 0x00ff00ff) |
                            (((M2i1 << 24) | (M2i1 >>> 8)) & 0xff00ff00)
                        );

                        // Absorb message into state
                        var lane = state[i];
                        lane.high ^= M2i1;
                        lane.low ^= M2i;
                    }

                    // Rounds
                    for (var round = 0; round < 24; round++) {
                        // Theta
                        for (var x = 0; x < 5; x++) {
                            // Mix column lanes
                            var tMsw = 0, tLsw = 0;
                            for (var y = 0; y < 5; y++) {
                                var lane = state[x + 5 * y];
                                tMsw ^= lane.high;
                                tLsw ^= lane.low;
                            }

                            // Temporary values
                            var Tx = T[x];
                            Tx.high = tMsw;
                            Tx.low = tLsw;
                        }
                        for (var x = 0; x < 5; x++) {
                            // Shortcuts
                            var Tx4 = T[(x + 4) % 5];
                            var Tx1 = T[(x + 1) % 5];
                            var Tx1Msw = Tx1.high;
                            var Tx1Lsw = Tx1.low;

                            // Mix surrounding columns
                            var tMsw = Tx4.high ^ ((Tx1Msw << 1) | (Tx1Lsw >>> 31));
                            var tLsw = Tx4.low ^ ((Tx1Lsw << 1) | (Tx1Msw >>> 31));
                            for (var y = 0; y < 5; y++) {
                                var lane = state[x + 5 * y];
                                lane.high ^= tMsw;
                                lane.low ^= tLsw;
                            }
                        }

                        // Rho Pi
                        for (var laneIndex = 1; laneIndex < 25; laneIndex++) {
                            // Shortcuts
                            var lane = state[laneIndex];
                            var laneMsw = lane.high;
                            var laneLsw = lane.low;
                            var rhoOffset = RHO_OFFSETS[laneIndex];

                            // Rotate lanes
                            if (rhoOffset < 32) {
                                var tMsw = (laneMsw << rhoOffset) | (laneLsw >>> (32 - rhoOffset));
                                var tLsw = (laneLsw << rhoOffset) | (laneMsw >>> (32 - rhoOffset));
                            } else /* if (rhoOffset >= 32) */ {
                                var tMsw = (laneLsw << (rhoOffset - 32)) | (laneMsw >>> (64 - rhoOffset));
                                var tLsw = (laneMsw << (rhoOffset - 32)) | (laneLsw >>> (64 - rhoOffset));
                            }

                            // Transpose lanes
                            var TPiLane = T[PI_INDEXES[laneIndex]];
                            TPiLane.high = tMsw;
                            TPiLane.low = tLsw;
                        }

                        // Rho pi at x = y = 0
                        var T0 = T[0];
                        var state0 = state[0];
                        T0.high = state0.high;
                        T0.low = state0.low;

                        // Chi
                        for (var x = 0; x < 5; x++) {
                            for (var y = 0; y < 5; y++) {
                                // Shortcuts
                                var laneIndex = x + 5 * y;
                                var lane = state[laneIndex];
                                var TLane = T[laneIndex];
                                var Tx1Lane = T[((x + 1) % 5) + 5 * y];
                                var Tx2Lane = T[((x + 2) % 5) + 5 * y];

                                // Mix rows
                                lane.high = TLane.high ^ (~Tx1Lane.high & Tx2Lane.high);
                                lane.low = TLane.low ^ (~Tx1Lane.low & Tx2Lane.low);
                            }
                        }

                        // Iota
                        var lane = state[0];
                        var roundConstant = ROUND_CONSTANTS[round];
                        lane.high ^= roundConstant.high;
                        lane.low ^= roundConstant.low;;
                    }
                },

                _doFinalize: function () {
                    // Shortcuts
                    var data = this._data;
                    var dataWords = data.words;
                    var nBitsTotal = this._nDataBytes * 8;
                    var nBitsLeft = data.sigBytes * 8;
                    var blockSizeBits = this.blockSize * 32;

                    // Add padding
                    dataWords[nBitsLeft >>> 5] |= 0x1 << (24 - nBitsLeft % 32);
                    dataWords[((Math.ceil((nBitsLeft + 1) / blockSizeBits) * blockSizeBits) >>> 5) - 1] |= 0x80;
                    data.sigBytes = dataWords.length * 4;

                    // Hash final blocks
                    this._process();

                    // Shortcuts
                    var state = this._state;
                    var outputLengthBytes = this.cfg.outputLength / 8;
                    var outputLengthLanes = outputLengthBytes / 8;

                    // Squeeze
                    var hashWords = [];
                    for (var i = 0; i < outputLengthLanes; i++) {
                        // Shortcuts
                        var lane = state[i];
                        var laneMsw = lane.high;
                        var laneLsw = lane.low;

                        // Swap endian
                        laneMsw = (
                            (((laneMsw << 8) | (laneMsw >>> 24)) & 0x00ff00ff) |
                            (((laneMsw << 24) | (laneMsw >>> 8)) & 0xff00ff00)
                        );
                        laneLsw = (
                            (((laneLsw << 8) | (laneLsw >>> 24)) & 0x00ff00ff) |
                            (((laneLsw << 24) | (laneLsw >>> 8)) & 0xff00ff00)
                        );

                        // Squeeze state to retrieve hash
                        hashWords.push(laneLsw);
                        hashWords.push(laneMsw);
                    }

                    // Return final computed hash
                    return new WordArray.init(hashWords, outputLengthBytes);
                },

                clone: function () {
                    var clone = Hasher.clone.call(this);

                    var state = clone._state = this._state.slice(0);
                    for (var i = 0; i < 25; i++) {
                        state[i] = state[i].clone();
                    }

                    return clone;
                }
            });

            /**
             * Shortcut function to the hasher's object interface.
             *
             * @param {WordArray|string} message The message to hash.
             *
             * @return {WordArray} The hash.
             *
             * @static
             *
             * @example
             *
             *     var hash = CryptoJS.SHA3('message');
             *     var hash = CryptoJS.SHA3(wordArray);
             */
            C.SHA3 = Hasher._createHelper(SHA3);

            /**
             * Shortcut function to the HMAC's object interface.
             *
             * @param {WordArray|string} message The message to hash.
             * @param {WordArray|string} key The secret key.
             *
             * @return {WordArray} The HMAC.
             *
             * @static
             *
             * @example
             *
             *     var hmac = CryptoJS.HmacSHA3(message, key);
             */
            C.HmacSHA3 = Hasher._createHmacHelper(SHA3);
        }(Math));


        return CryptoJS.SHA3;

    }));
}, { "./core": 17, "./x64-core": 19 }], 19: [function (require, module, exports) {
    ; (function (root, factory) {
        if (typeof exports === "object") {
            // CommonJS
            module.exports = exports = factory(require("./core"));
        }
        else if (typeof define === "function" && define.amd) {
            // AMD
            define(["./core"], factory);
        }
        else {
            // Global (browser)
            factory(root.CryptoJS);
        }
    }(this, function (CryptoJS) {

        (function (undefined) {
            // Shortcuts
            var C = CryptoJS;
            var C_lib = C.lib;
            var Base = C_lib.Base;
            var X32WordArray = C_lib.WordArray;

            /**
             * x64 namespace.
             */
            var C_x64 = C.x64 = {};

            /**
             * A 64-bit word.
             */
            var X64Word = C_x64.Word = Base.extend({
                /**
                 * Initializes a newly created 64-bit word.
                 *
                 * @param {number} high The high 32 bits.
                 * @param {number} low The low 32 bits.
                 *
                 * @example
                 *
                 *     var x64Word = CryptoJS.x64.Word.create(0x00010203, 0x04050607);
                 */
                init: function (high, low) {
                    this.high = high;
                    this.low = low;
                }

                /**
                 * Bitwise NOTs this word.
                 *
                 * @return {X64Word} A new x64-Word object after negating.
                 *
                 * @example
                 *
                 *     var negated = x64Word.not();
                 */
                // not: function () {
                // var high = ~this.high;
                // var low = ~this.low;

                // return X64Word.create(high, low);
                // },

                /**
                 * Bitwise ANDs this word with the passed word.
                 *
                 * @param {X64Word} word The x64-Word to AND with this word.
                 *
                 * @return {X64Word} A new x64-Word object after ANDing.
                 *
                 * @example
                 *
                 *     var anded = x64Word.and(anotherX64Word);
                 */
                // and: function (word) {
                // var high = this.high & word.high;
                // var low = this.low & word.low;

                // return X64Word.create(high, low);
                // },

                /**
                 * Bitwise ORs this word with the passed word.
                 *
                 * @param {X64Word} word The x64-Word to OR with this word.
                 *
                 * @return {X64Word} A new x64-Word object after ORing.
                 *
                 * @example
                 *
                 *     var ored = x64Word.or(anotherX64Word);
                 */
                // or: function (word) {
                // var high = this.high | word.high;
                // var low = this.low | word.low;

                // return X64Word.create(high, low);
                // },

                /**
                 * Bitwise XORs this word with the passed word.
                 *
                 * @param {X64Word} word The x64-Word to XOR with this word.
                 *
                 * @return {X64Word} A new x64-Word object after XORing.
                 *
                 * @example
                 *
                 *     var xored = x64Word.xor(anotherX64Word);
                 */
                // xor: function (word) {
                // var high = this.high ^ word.high;
                // var low = this.low ^ word.low;

                // return X64Word.create(high, low);
                // },

                /**
                 * Shifts this word n bits to the left.
                 *
                 * @param {number} n The number of bits to shift.
                 *
                 * @return {X64Word} A new x64-Word object after shifting.
                 *
                 * @example
                 *
                 *     var shifted = x64Word.shiftL(25);
                 */
                // shiftL: function (n) {
                // if (n < 32) {
                // var high = (this.high << n) | (this.low >>> (32 - n));
                // var low = this.low << n;
                // } else {
                // var high = this.low << (n - 32);
                // var low = 0;
                // }

                // return X64Word.create(high, low);
                // },

                /**
                 * Shifts this word n bits to the right.
                 *
                 * @param {number} n The number of bits to shift.
                 *
                 * @return {X64Word} A new x64-Word object after shifting.
                 *
                 * @example
                 *
                 *     var shifted = x64Word.shiftR(7);
                 */
                // shiftR: function (n) {
                // if (n < 32) {
                // var low = (this.low >>> n) | (this.high << (32 - n));
                // var high = this.high >>> n;
                // } else {
                // var low = this.high >>> (n - 32);
                // var high = 0;
                // }

                // return X64Word.create(high, low);
                // },

                /**
                 * Rotates this word n bits to the left.
                 *
                 * @param {number} n The number of bits to rotate.
                 *
                 * @return {X64Word} A new x64-Word object after rotating.
                 *
                 * @example
                 *
                 *     var rotated = x64Word.rotL(25);
                 */
                // rotL: function (n) {
                // return this.shiftL(n).or(this.shiftR(64 - n));
                // },

                /**
                 * Rotates this word n bits to the right.
                 *
                 * @param {number} n The number of bits to rotate.
                 *
                 * @return {X64Word} A new x64-Word object after rotating.
                 *
                 * @example
                 *
                 *     var rotated = x64Word.rotR(7);
                 */
                // rotR: function (n) {
                // return this.shiftR(n).or(this.shiftL(64 - n));
                // },

                /**
                 * Adds this word with the passed word.
                 *
                 * @param {X64Word} word The x64-Word to add with this word.
                 *
                 * @return {X64Word} A new x64-Word object after adding.
                 *
                 * @example
                 *
                 *     var added = x64Word.add(anotherX64Word);
                 */
                // add: function (word) {
                // var low = (this.low + word.low) | 0;
                // var carry = (low >>> 0) < (this.low >>> 0) ? 1 : 0;
                // var high = (this.high + word.high + carry) | 0;

                // return X64Word.create(high, low);
                // }
            });

            /**
             * An array of 64-bit words.
             *
             * @property {Array} words The array of CryptoJS.x64.Word objects.
             * @property {number} sigBytes The number of significant bytes in this word array.
             */
            var X64WordArray = C_x64.WordArray = Base.extend({
                /**
                 * Initializes a newly created word array.
                 *
                 * @param {Array} words (Optional) An array of CryptoJS.x64.Word objects.
                 * @param {number} sigBytes (Optional) The number of significant bytes in the words.
                 *
                 * @example
                 *
                 *     var wordArray = CryptoJS.x64.WordArray.create();
                 *
                 *     var wordArray = CryptoJS.x64.WordArray.create([
                 *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
                 *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
                 *     ]);
                 *
                 *     var wordArray = CryptoJS.x64.WordArray.create([
                 *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
                 *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
                 *     ], 10);
                 */
                init: function (words, sigBytes) {
                    words = this.words = words || [];

                    if (sigBytes != undefined) {
                        this.sigBytes = sigBytes;
                    } else {
                        this.sigBytes = words.length * 8;
                    }
                },

                /**
                 * Converts this 64-bit word array to a 32-bit word array.
                 *
                 * @return {CryptoJS.lib.WordArray} This word array's data as a 32-bit word array.
                 *
                 * @example
                 *
                 *     var x32WordArray = x64WordArray.toX32();
                 */
                toX32: function () {
                    // Shortcuts
                    var x64Words = this.words;
                    var x64WordsLength = x64Words.length;

                    // Convert
                    var x32Words = [];
                    for (var i = 0; i < x64WordsLength; i++) {
                        var x64Word = x64Words[i];
                        x32Words.push(x64Word.high);
                        x32Words.push(x64Word.low);
                    }

                    return X32WordArray.create(x32Words, this.sigBytes);
                },

                /**
                 * Creates a copy of this word array.
                 *
                 * @return {X64WordArray} The clone.
                 *
                 * @example
                 *
                 *     var clone = x64WordArray.clone();
                 */
                clone: function () {
                    var clone = Base.clone.call(this);

                    // Clone "words" array
                    var words = clone.words = this.words.slice(0);

                    // Clone each X64Word object
                    var wordsLength = words.length;
                    for (var i = 0; i < wordsLength; i++) {
                        words[i] = words[i].clone();
                    }

                    return clone;
                }
            });
        }());


        return CryptoJS;

    }));
}, { "./core": 17 }], 20: [function (require, module, exports) {
    module.exports = {
        "_args": [
            [
                {
                    "raw": "truffle-contract-schema@0.0.5",
                    "scope": null,
                    "escapedName": "truffle-contract-schema",
                    "name": "truffle-contract-schema",
                    "rawSpec": "0.0.5",
                    "spec": "0.0.5",
                    "type": "version"
                },
                "/Users/tim/Documents/workspace/Consensys/truffle-contract"
            ]
        ],
        "_from": "truffle-contract-schema@0.0.5",
        "_id": "truffle-contract-schema@0.0.5",
        "_inCache": true,
        "_location": "/truffle-contract-schema",
        "_nodeVersion": "6.9.1",
        "_npmOperationalInternal": {
            "host": "packages-12-west.internal.npmjs.com",
            "tmp": "tmp/truffle-contract-schema-0.0.5.tgz_1485557985137_0.46875762194395065"
        },
        "_npmUser": {
            "name": "tcoulter",
            "email": "tim@timothyjcoulter.com"
        },
        "_npmVersion": "3.10.8",
        "_phantomChildren": {},
        "_requested": {
            "raw": "truffle-contract-schema@0.0.5",
            "scope": null,
            "escapedName": "truffle-contract-schema",
            "name": "truffle-contract-schema",
            "rawSpec": "0.0.5",
            "spec": "0.0.5",
            "type": "version"
        },
        "_requiredBy": [
            "/"
        ],
        "_resolved": "https://registry.npmjs.org/truffle-contract-schema/-/truffle-contract-schema-0.0.5.tgz",
        "_shasum": "5e9d20bd0bf2a27fe94310748249d484eee49961",
        "_shrinkwrap": null,
        "_spec": "truffle-contract-schema@0.0.5",
        "_where": "/Users/tim/Documents/workspace/Consensys/truffle-contract",
        "author": {
            "name": "Tim Coulter",
            "email": "tim.coulter@consensys.net"
        },
        "bugs": {
            "url": "https://github.com/trufflesuite/truffle-schema/issues"
        },
        "dependencies": {
            "crypto-js": "^3.1.9-1"
        },
        "description": "JSON schema for contract artifacts",
        "devDependencies": {
            "mocha": "^3.2.0"
        },
        "directories": {},
        "dist": {
            "shasum": "5e9d20bd0bf2a27fe94310748249d484eee49961",
            "tarball": "https://registry.npmjs.org/truffle-contract-schema/-/truffle-contract-schema-0.0.5.tgz"
        },
        "gitHead": "cfa4313bd4bb95bf5b94f85185203ead418f9ee6",
        "homepage": "https://github.com/trufflesuite/truffle-schema#readme",
        "keywords": [
            "ethereum",
            "json",
            "schema",
            "contract",
            "artifacts"
        ],
        "license": "MIT",
        "main": "index.js",
        "maintainers": [
            {
                "name": "tcoulter",
                "email": "tim@timothyjcoulter.com"
            }
        ],
        "name": "truffle-contract-schema",
        "optionalDependencies": {},
        "readme": "ERROR: No README data found!",
        "repository": {
            "type": "git",
            "url": "git+https://github.com/trufflesuite/truffle-schema.git"
        },
        "scripts": {
            "test": "mocha"
        },
        "version": "0.0.5"
    }

}, {}]}, { }, [2]);