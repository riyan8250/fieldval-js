var FieldVal = (function(){
    "use strict";

    /* istanbul ignore next */
    if (!Array.isArray) {
        Array.isArray = function (value) {
            return (Object.prototype.toString.call(value) === '[object Array]');
        };
    }

    var is_empty = function(obj){
        var key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) return false;
        }
        return true;
    }

    function FieldVal(validating, existing_error) {
        var fv = this;

        fv.async_waiting = 0;

        fv.validating = validating;
        fv.missing_keys = {};
        fv.invalid_keys = {};
        fv.unrecognized_keys = {};
        fv.recognized_keys = {};

        //Top level errors - added using .error() 
        fv.errors = [];

        if(existing_error!==undefined){
            //Provided a (potentially undefined) existing error

            if(existing_error){
                var key_error;
                if(existing_error.error===FieldVal.ONE_OR_MORE_ERRORS){
                    //The existing_error is a key error
                    key_error = existing_error;
                } else if(existing_error.error===FieldVal.MULTIPLE_ERRORS){
                    for(var i = 0; i < existing_error.errors.length; i++){
                        var inner_error = existing_error.errors[i];

                        if(inner_error.error===0){
                            key_error = inner_error;
                            //Don't add the key_error to fv.errors (continue)
                            continue;
                        }
                        //Add other errors to fv.errors
                        fv.errors.push(inner_error);
                    }
                } else {
                    //Only have non-key error
                    fv.errors.push(existing_error);
                }

                if(key_error){
                    for(var j in validating){
                        if(validating.hasOwnProperty(j)) {
                            fv.recognized_keys[j] = true;
                        }
                    }
                    if(key_error.missing){
                        fv.missing_keys = key_error.missing;
                    }
                    if(key_error.unrecognized){
                        fv.unrecognized_keys = key_error.unrecognized;
                        for(var k in fv.unrecognized_keys){
                            if(fv.unrecognized_keys.hasOwnProperty(k)) {
                                delete fv.recognized_keys[k];
                            }
                        }
                    }
                    if(key_error.invalid){
                        fv.invalid_keys = key_error.invalid;
                    }

                }
            } else {
                for(var n in validating){
                    if(validating.hasOwnProperty(n)) {
                        fv.recognized_keys[n] = true;
                    }
                }
            }
        }
    }

    FieldVal.prototype.dig = function(){
        var fv = this;

        var keys;
        var first_argument = arguments[0];
        if(Array.isArray(first_argument)){
            keys = first_argument;
        } else {
            keys = arguments;
        }

        var current_value = fv.validating;
        var current_error = fv;
        for(var i = 0; i < keys.length; i++){
            var this_key = keys[i];
            current_value = current_value[this_key];
            if(current_value===undefined){
                return undefined;
            }
            if(current_error){
                var invalid;
                if(current_error instanceof FieldVal){
                    invalid = current_error.invalid_keys;
                } else {
                    invalid = current_error.invalid;
                }
                if(invalid){
                    current_error = invalid[this_key];
                }
            }
        }
        return new FieldVal(current_value,current_error);
    };

    //TODO guard against invalid arguments
    FieldVal.prototype.invalid = function(){
        var fv = this;

        //error is the last argument, previous arguments are keys
        var error = arguments[arguments.length-1];

        var keys, keys_length;
        if(arguments.length===2){

            var first_argument = arguments[0];
            if(Array.isArray(first_argument)){
                keys = first_argument;
                keys_length = first_argument.length;
            } else {

                fv.invalid_keys[arguments[0]] = FieldVal.add_to_invalid(
                    error, 
                    fv.invalid_keys[arguments[0]]
                );

                return fv;
            }
        } else {
            keys = arguments;
            keys_length = arguments.length - 1;
        }

        var current_error = fv;
        for(var i = 0; i < keys_length; i++){
            var this_key = keys[i];

            var current_invalid;
            if(current_error instanceof FieldVal){
                current_invalid = current_error.invalid_keys;
            } else {
                current_invalid = current_error.invalid;
            }

            var new_error;
            if(i===keys_length-1){
                new_error = error;
            } else{
                new_error = current_invalid[this_key];
            }
            if(!new_error){
                new_error = {
                    error: FieldVal.ONE_OR_MORE_ERRORS,
                    error_message: FieldVal.ONE_OR_MORE_ERRORS_STRING,
                    invalid: {}
                };
            }

            if(current_error instanceof FieldVal){
                current_error.invalid(this_key, new_error);
            } else {
                current_invalid[this_key] = FieldVal.add_to_invalid(
                    new_error, 
                    current_invalid[this_key]
                );
            }

            current_error = new_error;
        }

        return fv;
    };

    FieldVal.prototype.default_value = function (default_value) {
        var fv = this;

        return {
            get: function () {
                var get_result = fv.get.apply(fv, arguments);
                if (get_result !== undefined) {
                    return get_result;
                }
                //No value. Return the default
                return default_value;
            }
        };
    };

    FieldVal.prototype.get = function (field_name) {//Additional arguments are checks
        var fv = this;

        var checks = Array.prototype.slice.call(arguments, 1);

        var did_return = false;
        var to_return;
        var async_return = fv.get_async(field_name, checks, function(value){
            did_return = true;
            to_return = value;
        });

        if(async_return===FieldVal.ASYNC){
            //At least one of the checks is async
            throw new Error(".get used with async checks, use .get_async.");
        } else {
            return to_return;
        }
    };

    FieldVal.prototype.get_async = function (field_name, checks, done){
        var fv = this;

        if(!Array.isArray(checks)){
            throw new Error(".get_async second argument must be an array of checks");
        }

        var value = fv.validating[field_name];
        fv.recognized_keys[field_name] = true;

        var use_checks_res = FieldVal.use_checks(value, checks, {
            validator: fv, 
            field_name: field_name,
            emit: function (new_value) {
                value = new_value;
            }
        },function(check_result){
            if(done!==undefined){
                done(value);
            }
        });

        return (use_checks_res === FieldVal.ASYNC) ? FieldVal.ASYNC : undefined;
    };

    //Top level error - something that cannot be assigned to a particular key
    FieldVal.prototype.error = function (error) {
        var fv = this;

        fv.errors.push(error);

        return fv;
    };

    FieldVal.add_to_invalid = function(this_error, existing){
        var fv = this;

        if (existing !== undefined) {

            //Add to an existing error
            if (existing.errors !== undefined) {
                for(var i = 0; i < existing.errors.length; i++){
                    var inner_error = existing.errors;
                    //If error codes match
                    if(inner_error.error!==undefined && (inner_error.error === this_error.error)){
                        //Replace the error
                        existing.errors[i] = this_error;
                    }
                }
                existing.errors.push(this_error);
            } else {
                //If the error codes match
                if(existing.error!==undefined && (existing.error === this_error.error)){
                    //Replace the error
                    existing = this_error;
                } else {
                    existing = {
                        error: FieldVal.MULTIPLE_ERRORS,
                        error_message: "Multiple errors.",
                        errors: [existing, this_error]
                    };
                }
            }
            return existing;
        } 
        return this_error;
    };

    FieldVal.prototype.missing = function (field_name, flags) {
        var fv = this;

        fv.missing_keys[field_name] = FieldVal.create_error(FieldVal.MISSING_ERROR, flags);
        return fv;
    };

    FieldVal.prototype.unrecognized = function (field_name) {
        var fv = this;

        fv.unrecognized_keys[field_name] = {
            error_message: "Unrecognized field.",
            error: FieldVal.FIELD_UNRECOGNIZED
        };
        return fv;
    };

    FieldVal.prototype.recognized = function (field_name) {
        var fv = this;

        fv.recognized_keys[field_name] = true;

        return fv;
    };

    //Exists to allow processing of remaining keys after known keys are checked
    FieldVal.prototype.get_unrecognized = function () {
        var fv = this;

        var unrecognized = [];
        var key;
        for (key in fv.validating) {
            /* istanbul ignore else */
            if (fv.validating.hasOwnProperty(key)) {
                if (fv.recognized_keys[key] !== true) {
                    unrecognized.push(key);
                }
            }
        }
        return unrecognized;
    };

    FieldVal.prototype.async_call_ended = function(){
        var fv = this;

        fv.async_waiting--;

        if(fv.async_waiting<=0){
            if(fv.end_callback){
                fv.end_callback(fv.generate_response(), fv.recognized_keys);
            }
        }
    };

    FieldVal.prototype.generate_response = function(){
        var fv = this;

        var returning = {};

        var has_error = false;

        var returning_unrecognized = {};

        //Iterate through manually unrecognized keys
        var key;
        for (key in fv.unrecognized_keys) {
            /* istanbul ignore else */
            if (fv.unrecognized_keys.hasOwnProperty(key)) {
                returning_unrecognized[key] = fv.unrecognized_keys[key];
            }
        }

        var auto_unrecognized = fv.get_unrecognized();
        var i, auto_key;
        for (i = 0; i < auto_unrecognized.length; i++) {
            auto_key = auto_unrecognized[i];
            if (!returning_unrecognized[auto_key]) {
                returning_unrecognized[auto_key] = {
                    error_message: "Unrecognized field.",
                    error: FieldVal.FIELD_UNRECOGNIZED
                };
            }
        }

        if (!is_empty(fv.missing_keys)) {
            returning.missing = fv.missing_keys;
            has_error = true;
        }
        if (!is_empty(fv.invalid_keys)) {
            returning.invalid = fv.invalid_keys;
            has_error = true;
        }
        if (!is_empty(returning_unrecognized)) {
            returning.unrecognized = returning_unrecognized;
            has_error = true;
        }

        if (has_error) {
            returning.error_message = FieldVal.ONE_OR_MORE_ERRORS_STRING;
            returning.error = FieldVal.ONE_OR_MORE_ERRORS;

            if (fv.errors.length === 0) {
                return returning;
            }

            fv.errors.push(returning);
        }

        if (fv.errors.length !== 0) {
            //Have top level errors

            if (fv.errors.length === 1) {
                //Only 1 error, just return it
                return fv.errors[0];
            }

            //Return a "multiple errors" error
            return {
                error: FieldVal.MULTIPLE_ERRORS,
                error_message: "Multiple errors.",
                errors: fv.errors
            };
        }

        return null;
    };

    FieldVal.prototype.end = function (callback) {
        var fv = this;

        if(callback){
            fv.end_callback = callback;

            if(fv.async_waiting<=0){
                callback(fv.generate_response(), fv.recognized_keys);
            }
        } else {
            return fv.generate_response();
        }
    };

    FieldVal.prototype.end_with_recognized = function (callback) {
        var fv = this;

        if(callback){
            fv.end(callback);
        } else {
            if(fv.async_waiting>0){
                return [fv.generate_response(), fv.recognized_keys];
            }
        }
    };

    /* Global namespaces (e.g. Math.sqrt) are used as constants 
     * to prevent multiple instances of FieldVal (due to being 
     * a dependency) having not-strictly-equal constants. */
    FieldVal.ASYNC = -1;//Used to indicate async functions
    FieldVal.REQUIRED_ERROR = Math.sqrt;
    FieldVal.NOT_REQUIRED_BUT_MISSING = Math.floor;

    FieldVal.ONE_OR_MORE_ERRORS = 0;
    FieldVal.ONE_OR_MORE_ERRORS_STRING = "One or more errors.";
    FieldVal.FIELD_MISSING = 1;
    FieldVal.INCORRECT_FIELD_TYPE = 2;
    FieldVal.FIELD_UNRECOGNIZED = 3;
    FieldVal.MULTIPLE_ERRORS = 4;

    FieldVal.INCORRECT_TYPE_ERROR = function (expected_type, type) {
        return {
            error_message: "Incorrect field type. Expected " + expected_type + ".",
            error: FieldVal.INCORRECT_FIELD_TYPE,
            expected: expected_type,
            received: type
        };
    };

    FieldVal.MISSING_ERROR = function () {
        return {
            error_message: "Field missing.",
            error: FieldVal.FIELD_MISSING
        };
    };

    FieldVal.get_value_and_type = function (value, desired_type, flags) {
        if (!flags) {
            flags = {};
        }
        var parse = flags.parse !== undefined ? flags.parse : false;

        if (typeof value !== 'string' || parse) {
            if (desired_type === "integer") {
                var parsed_int = parseInt(value, 10);
                if (!isNaN(parsed_int) && (parsed_int.toString()).length === (value.toString()).length) {
                    value = parsed_int;
                    desired_type = parsed_int;
                    desired_type = "number";
                }
            } else if (desired_type === "float" || desired_type === "number") {
                var parsed_float = parseFloat(value, 10);
                if (!isNaN(parsed_float) && (parsed_float.toString()).length === (value.toString()).length) {
                    value = parsed_float;
                    desired_type = "number";
                }
            } else if (desired_type === "boolean") {
                if(value === 'true'){
                    value = true;
                }
                if(value === 'false'){
                    value = false;
                }
            }
        }

        var type = typeof value;

        if (type === "object") {
            //typeof on Array returns "object", do check for an array
            if (Array.isArray(value)) {
                type = "array";
            }
        }

        return {
            type: type,
            desired_type: desired_type,
            value: value
        };
    };

    FieldVal.use_check = function (this_check, shared_options, use_check_done) {

        var this_check_function;
        var stop_on_error = true;//Default to true
        var flags = {};
        var i = 0;

        if ((typeof this_check) === 'object') {
            if (Array.isArray(this_check)) {
                var any_async = false;
                var this_check_array = this_check;
                var did_return = false;
                var check_done = function(){
                    i++;
                    if(shared_options.stop || i>this_check_array.length){
                        did_return = true;
                        use_check_done();
                        return;
                    }
                    var check_res = FieldVal.use_check(
                        this_check_array[i-1],
                        shared_options,
                        function(){
                            check_done();
                        }
                    );
                    if(check_res===FieldVal.ASYNC){
                        any_async = true;
                    }
                };
                check_done();
                if(did_return){
                    if(any_async){
                        return FieldVal.ASYNC;
                    } else {
                        return;
                    }
                }
                return FieldVal.ASYNC;
            } else {
                flags = this_check;
                this_check_function = flags.check;
                if (flags && (flags.stop_on_error !== undefined)) {
                    stop_on_error = flags.stop_on_error;
                }
            }
        } else if(typeof this_check === 'function') {
            this_check_function = this_check;
            stop_on_error = true;//defaults to true
        } else {
            throw new Error("A check can only be provided as a function or as an object with a function as the .check property.");
        }

        var with_response = function(response){
            if (response !== null && response !== undefined) {
                if (stop_on_error) {
                    shared_options.stop = true;
                }
                shared_options.had_error = true;

                if (response === FieldVal.REQUIRED_ERROR) {

                    if (shared_options.field_name!==undefined) {
                        shared_options.validator.missing(shared_options.field_name, flags);
                        use_check_done();
                        return;
                    } else {
                        if (shared_options.existing_validator) {
                        
                            shared_options.validator.error(
                                FieldVal.create_error(FieldVal.MISSING_ERROR, flags)
                            );
                            use_check_done();
                            return;
                        } else {
                            shared_options.return_missing = true;
                            use_check_done();
                            return;
                        }
                    }
                } else if (response === FieldVal.NOT_REQUIRED_BUT_MISSING) {
                    //NOT_REQUIRED_BUT_MISSING means "don't process proceeding checks, but don't throw an error"
                    use_check_done();
                } else {

                    if (shared_options.existing_validator) {
                        if (shared_options.field_name!==undefined) {
                            shared_options.validator.invalid(shared_options.field_name, response);
                        } else {
                            shared_options.validator.error(response);
                        }
                        use_check_done();
                    } else {
                        shared_options.validator.error(response);
                        use_check_done();
                    }
                }
            } else {
                use_check_done();
            }
        };

        var check_response = this_check_function(shared_options.value, shared_options.emit, function(response){
            //Response callback
            with_response(response);
        });
        if (this_check_function.length===3){//Is async - it has a third (callback) parameter
            //Waiting for async
            return FieldVal.ASYNC;
        } else {
            with_response(check_response);
            return null;
        }
    };

    FieldVal.use_checks = function (value, checks, options, done) {

        if(typeof options === 'function'){
            done = options;
            options = undefined;
        }

        if(!options){
            options = {};
        }

        var shared_options = {
            value: value,
            field_name: options.field_name,
            emit: function(emitted){
                shared_options.value = emitted;
            },
            options: options,
            stop: false,
            return_missing: false,
            had_error: false
        };

        if (options.validator) {
            shared_options.validator = options.validator;
            shared_options.existing_validator = true;
        } else {
            shared_options.validator = new FieldVal();
        }

        var did_return = false;
        var to_return;
        var finish = function(response){
            to_return = response;
            did_return = true;
            if(done){//The done callback isn't required
                done(response);
            }
        };
        shared_options.validator.async_waiting++;
        
        var use_check_res = FieldVal.use_check(checks || [], shared_options, function(){
            if (shared_options.had_error) {
                if (shared_options.options.emit) {
                    shared_options.options.emit(undefined);
                }
            } else {
                if (shared_options.options.emit) {
                    shared_options.options.emit(shared_options.value);
                }
            }

            if (shared_options.return_missing) {
                finish(FieldVal.REQUIRED_ERROR);
                shared_options.validator.async_call_ended();
                return;
            }

            if(!shared_options.existing_validator){
                finish(shared_options.validator.end());
                shared_options.validator.async_call_ended();
                return;
            }

            finish(null);
            shared_options.validator.async_call_ended();
            return;
        });
        if(use_check_res===FieldVal.ASYNC){
            if(done){//The done callback isn't required
                finish = done;
            }
            return FieldVal.ASYNC;
        } 
        if(did_return){
            return to_return;
        } else {
            return FieldVal.ASYNC;
        }
    };

    FieldVal.required = function (required, flags) {//required defaults to true
        var check = function (value) {
            if (value === null || value === undefined) {
                if (required || required === undefined) {
                    return FieldVal.REQUIRED_ERROR;
                }

                return FieldVal.NOT_REQUIRED_BUT_MISSING;
            }
        };
        if (flags !== undefined) {
            flags.check = check;
            return flags;
        }
        return check;
    };

    FieldVal.type = function (desired_type, flags) {

        var required = (flags && flags.required !== undefined) ? flags.required : true;

        var check = function (value, emit) {

            var required_error = FieldVal.required(required)(value);

            if (required_error) {
                return required_error;
            }

            var value_and_type = FieldVal.get_value_and_type(value, desired_type, flags);

            var inner_desired_type = value_and_type.desired_type;
            var type = value_and_type.type;
            value = value_and_type.value;

            if (type !== inner_desired_type) {
                return FieldVal.create_error(FieldVal.INCORRECT_TYPE_ERROR, flags, inner_desired_type, type);
            }
            if (emit) {
                emit(value);
            }
        };

        if (flags !== undefined) {
            flags.check = check;
            return flags;
        }

        return check;
    };

    FieldVal.create_error = function (default_error, flags) {
        if (!flags) {
            return default_error.apply(null, Array.prototype.slice.call(arguments, 2));
        }
        if (default_error === FieldVal.MISSING_ERROR) {
            var missing_error_type = typeof flags.missing_error;

            /* istanbul ignore else */
            if (missing_error_type === 'function') {
                return flags.missing_error.apply(null, Array.prototype.slice.call(arguments, 2));
            } else if (missing_error_type === 'object') {
                return flags.missing_error;
            } else if (missing_error_type === 'string') {
                return {
                    error_message: flags.missing_error
                };
            }
        } else {
            var error_type = typeof flags.error;

            /* istanbul ignore else */
            if (error_type === 'function') {
                return flags.error.apply(null, Array.prototype.slice.call(arguments, 2));
            } else if (error_type === 'object') {
                return flags.error;
            } else if (error_type === 'string') {
                return {
                    error_message: flags.error
                };
            }
        }

        return default_error.apply(null, Array.prototype.slice.call(arguments, 2));
    };

    var BasicVal = (function(){

    if (!Array.prototype.indexOf) {
        Array.prototype.indexOf = function(searchElement, fromIndex) {
            var k;
            if (this === null) {
                throw new TypeError('"this" is null or not defined');
            }

            var O = Object(this);
            var len = O.length >>> 0;
            if (len === 0) {
                return -1;
            }
            var n = +fromIndex || 0;
            if (Math.abs(n) === Infinity) {
                n = 0;
            }
            if (n >= len) {
                return -1;
            }
            k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
            while (k < len) {
                var kValue;
                if (k in O && O[k] === searchElement) {
                    return k;
                }
                k++;
            }
            return -1;
        };
    }

    var BasicVal = {
        errors: {
            too_short: function(min_len) {
                return {
                    error: 100,
                    error_message: "Length is less than " + min_len
                };
            },
            too_long: function(max_len) {
                return {
                    error: 101,
                    error_message: "Length is greater than " + max_len
                };
            },
            too_small: function(min_val) {
                return {
                    error: 102,
                    error_message: "Value is less than " + min_val
                };
            },
            too_large: function(max_val) {
                return {
                    error: 103,
                    error_message: "Value is greater than " + max_val
                };
            },
            not_in_list: function() {
                return {
                    error: 104,
                    error_message: "Value is not a valid choice"
                };
            },
            cannot_be_empty: function() {
                return {
                    error: 105,
                    error_message: "Value cannot be empty."
                };
            },
            no_prefix: function(prefix) {
                return {
                    error: 106,
                    error_message: "Value does not have prefix: " + prefix
                };
            },
            invalid_email: function() {
                return {
                    error: 107,
                    error_message: "Invalid email address format."
                };
            },
            invalid_url: function() {
                return {
                    error: 108,
                    error_message: "Invalid url format."
                };
            },
            incorrect_length: function(len){
                return {
                    error: 109,
                    error_message: "Length is not equal to " + len
                };
            },
            no_suffix: function(suffix) {
                return {
                    error: 110,
                    error_message: "Value does not have suffix: " + suffix
                };
            },
            //111 in DateVal
            //112 in DateVal
            not_equal: function(match){
                return {
                    error: 113,
                    error_message: "Not equal to " + match + ".",

                };
            },
            //114 in DateVal
            no_valid_option: function(){//Should be overriden in most cases
                return {
                    error: 115,
                    error_message: "None of the options were valid.",
                };
            },
            contains_whitespace: function(){
                return {
                    error: 116,
                    error_message: "Contains whitespace."
                };
            },
            must_start_with_letter: function(){
                return {
                    error: 117,
                    error_message: "Must start with a letter."
                };  
            },
            value_in_list: function() {
                return {
                    error: 104,
                    error_message: "Value not allowed"
                };
            },
            should_not_contain: function(characters) {
                var disallowed = characters.join(",");
                return {
                    error: 105,
                    error_message: "Cannot contain "+disallowed
                };
            }
        },
        equal_to: function(match, flags){
            var check = function(value) {
                if (value!==match) {
                    return FieldVal.create_error(BasicVal.errors.not_equal, flags, match);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        merge_required_and_flags: function(required, flags){
            if((typeof required)==="object"){
                flags = required;
            } else {
                if(!flags){
                    flags = {};
                }
                flags.required = required;
            }
            return flags;
        },
        integer: function(required, flags){
            return FieldVal.type("integer",BasicVal.merge_required_and_flags(required, flags));
        },
        number: function(required, flags){
            return FieldVal.type("number",BasicVal.merge_required_and_flags(required, flags));
        },
        array: function(required, flags){
            return FieldVal.type("array",BasicVal.merge_required_and_flags(required, flags));
        },
        object: function(required, flags){
            return FieldVal.type("object",BasicVal.merge_required_and_flags(required, flags));
        },
        float: function(required, flags){
            return FieldVal.type("float",BasicVal.merge_required_and_flags(required, flags));
        },
        boolean: function(required, flags){
            return FieldVal.type("boolean",BasicVal.merge_required_and_flags(required, flags));
        },
        string: function(required, flags){
            flags = BasicVal.merge_required_and_flags(required, flags);
            var check = function(value, emit) {

                var core_check = FieldVal.type("string",flags);
                if(typeof core_check === 'object'){
                    //Passing flags turns the check into an object
                    core_check = core_check.check;
                }

                //Passing emit means that the value can be changed
                var error = core_check(value,emit);
                if(error) return error;

                if(!flags || flags.trim!==false){//If not explicitly false
                    value = value.trim();
                }
                if (value.length === 0) {
                    if(required || required===undefined){
                        return FieldVal.REQUIRED_ERROR;
                    } else {
                        return FieldVal.NOT_REQUIRED_BUT_MISSING;
                    }
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        length: function(len, flags) {
            var check = function(value) {
                if (value.length!==len) {
                    return FieldVal.create_error(BasicVal.errors.incorrect_length, flags, len);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        min_length: function(min_len, flags) {
            var check = function(value) {
                if (value.length < min_len) {
                    return FieldVal.create_error(BasicVal.errors.too_short, flags, min_len);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        max_length: function(max_len, flags) {
            var check = function(value) {
                if (value.length > max_len) {
                    return FieldVal.create_error(BasicVal.errors.too_long, flags, max_len);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        no_whitespace: function(flags) {
            var check = function(value) {
                if (/\s/.test(value)){
                    return FieldVal.create_error(BasicVal.errors.contains_whitespace, flags, max_len);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        minimum: function(min_val, flags) {
            var check = function(value) {
                if (value < min_val) {
                    return FieldVal.create_error(BasicVal.errors.too_small, flags, min_val);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        maximum: function(max_val, flags) {
            var check = function(value) {
                if (value > max_val) {
                    return FieldVal.create_error(BasicVal.errors.too_large, flags, max_val);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        range: function(min_val, max_val, flags) {
            //Effectively combines minimum and maximum
            var check = function(value){
                if (value < min_val) {
                    return FieldVal.create_error(BasicVal.errors.too_small, flags, min_val);
                } else if (value > max_val) {
                    return FieldVal.create_error(BasicVal.errors.too_large, flags, max_val);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        does_not_contain: function(characters, flags){
            if(!Array.isArray(characters)){
                characters = [characters];
            }
            var check = function(value) {
                for(var i = 0; i < characters.length; i++){
                    if(value.indexOf(characters[i])!==-1){
                        return FieldVal.create_error(BasicVal.errors.should_not_contain, flags, characters);
                    }
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        one_of: function(array, flags) {
            var valid_values = [];
            if(Array.isArray(array)){
                for(var i = 0; i < array.length; i++){
                    var option = array[i];
                    if((typeof option) === 'object'){
                        valid_values.push(option[0]);
                    } else {
                        valid_values.push(option);
                    }
                }
            } else {
                for(var k in array){
                    if(array.hasOwnProperty(k)){
                        valid_values.push(k);
                    }
                }
            }
            var check = function(value) {
                if (valid_values.indexOf(value) === -1) {
                    return FieldVal.create_error(BasicVal.errors.not_in_list, flags);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        not_one_of: function(array, flags) {
            var valid_values = [];
            if(Object.prototype.toString.call(array) === '[object Array]'){
                for(var i = 0; i < array.length; i++){
                    var option = array[i];
                    if((typeof option) === 'object'){
                        valid_values.push(option[0]);
                    } else {
                        valid_values.push(option);
                    }
                }
            } else {
                for(var k in array){
                    if(array.hasOwnProperty(k)){
                        valid_values.push(k);
                    }
                }
            }
            var check = function(value) {
                if (valid_values.indexOf(value) !== -1) {
                    return FieldVal.create_error(BasicVal.errors.value_in_list, flags);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        not_empty: function(trim, flags) {
            var check = function(value) {
                if (trim) {
                    if (value.trim().length === 0) {
                        if(typeof flags.error){
                        }
                        return FieldVal.create_error(BasicVal.errors.cannot_be_empty, flags);
                    }
                } else {
                    if (value.length === 0) {
                        return FieldVal.create_error(BasicVal.errors.cannot_be_empty, flags);
                    }
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        prefix: function(prefix, flags) {
            var check = function(value) {
                if (value.length >= prefix.length) {
                    if (value.substring(0, prefix.length) != prefix) {
                        return FieldVal.create_error(BasicVal.errors.no_prefix, flags, prefix);
                    }
                } else {
                    return FieldVal.create_error(BasicVal.errors.no_prefix, flags, prefix);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        start_with_letter: function(flags) {
            var check = function(value) {
                if (value.length > 0) {
                    var char_code = value.charCodeAt(0);
                    if( !((char_code >= 65 && char_code <= 90) || (char_code >= 97 && char_code <= 122))){
                        return FieldVal.create_error(BasicVal.errors.must_start_with_letter, flags);
                    }
                } else {
                    return FieldVal.create_error(BasicVal.errors.must_start_with_letter, flags);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        suffix: function(suffix, flags) {
            var check = function(value) {
                if (value.length >= suffix.length) {
                    if (value.substring(value.length-suffix.length, value.length) != suffix) {
                        return FieldVal.create_error(BasicVal.errors.no_suffix, flags, suffix);
                    }
                } else {
                    return FieldVal.create_error(BasicVal.errors.no_suffix, flags, suffix);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        each: function(on_each, flags) {
            var check = function(array, stop) {
                var validator = new FieldVal(null);
                var iterator = function(i){
                    var value = array[i];

                    var res = on_each(value,i,function(emitted_value){
                        array[i] = emitted_value;
                    });
                    if(res===FieldVal.ASYNC){
                        throw new Error(".each used with async checks, use .each_async.");
                    }
                    if (res === FieldVal.REQUIRED_ERROR){
                        validator.missing("" + i);
                    } else if (res) {
                        validator.invalid("" + i, res);
                    }
                };
                if(Array.isArray(array)){
                    for (var i = 0; i < array.length; i++) {
                        iterator(i);
                    }
                } else {
                    for (var k in array) {
                        if(array.hasOwnProperty(k)){
                            iterator(k);
                        }
                    }
                }
                var error = validator.end();
                if(error){
                    return error;
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        each_async: function(on_each, flags) {
            var check = function(array, emit, callback) {

                var is_array = Array.isArray(array);
                var keys;
                if(!is_array){
                    keys = Object.keys(array);
                }
                
                var validator = new FieldVal(null);
                var idx = 0;
                var i,value;
                if(is_array){
                    i = idx;
                }
                var do_possible = function(){
                    if(is_array){
                        i++;
                        if(i>array.length){
                            callback(validator.end());
                            return;
                        }
                        value = array[i-1];
                    } else {
                        idx++;
                        if(idx>keys.length){
                            callback(validator.end());
                            return;
                        }
                        i = keys[idx-1];
                        value = array[i];
                    }

                    FieldVal.use_checks(value, [function(value, emit, next){
                        on_each(value,i,emit,next);
                    }], {
                        field_name: is_array ? (""+(i-1)) : i,
                        validator: validator,
                        emit: function(emitted_value){
                            if(is_array){
                                array[i-1] = emitted_value;
                            } else {
                                array[i] = emitted_value;
                            }
                        }
                    }, function(response){
                        do_possible();
                    });
                };
                do_possible();
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        multiple: function(possibles, flags){

            possibles = possibles || [];
            if(possibles.length===0){
                console.error("BasicVal.multiple called without possibles.");
            }
            
            var check = function(value, emit){
                for(var i = 0; i < possibles.length; i++){
                    var option = possibles[i];
            
                    var emitted_value;
                    var option_error = FieldVal.use_checks(value, option, null, null, function(emitted){
                        emitted_value = emitted;
                    })
                    if(option_error===FieldVal.ASYNC){
                        throw new Error(".multiple used with async checks, use .multiple_async.");
                    }
                    if(!option_error){
                        if(emitted_value!==undefined){
                            emit(emitted_value);
                        }
                        return null;
                    }
                }
                return FieldVal.create_error(BasicVal.errors.no_valid_option, flags);
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        multiple_async: function(possibles, flags){

            possibles = possibles || [];
            if(possibles.length===0){
                console.error("BasicVal.multiple_async called without possibles.");
                return;
            }

            var to_return;
            var check = function(value, emit, callback){
                var emitted_value;
                var emit_for_check = function(emitted){
                    emitted_value = emitted;
                };
                var i = 0;
                var do_possible = function(){
                    i++;
                    if(i>possibles.length){
                        callback(FieldVal.create_error(BasicVal.errors.no_valid_option, flags));
                        return;
                    }
                    var option = possibles[i-1];

                    FieldVal.use_checks(value, option, {
                        field_name: null,
                        validator: null,
                        emit: emit_for_check
                    }, function(response){
                        if(!response){
                            callback(undefined);//Success
                        } else {
                            do_possible();
                        }
                    });
                };
                do_possible();
                return to_return;
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        email: function(flags){
            var check = function(value) {
                var re = BasicVal.email_regex;
                if(!re.test(value)){
                    return FieldVal.create_error(BasicVal.errors.invalid_email, flags);
                } 
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        url: function(flags){
            var check = function(value) {
                var re = BasicVal.url_regex;
                if(!re.test(value)){
                    return FieldVal.create_error(BasicVal.errors.invalid_url, flags);
                } 
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        }
    };

    BasicVal.email_regex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    BasicVal.url_regex = /^(https?):\/\/(((([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))|((([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])))(:[1-9][0-9]+)?(\/)?([\/?].+)?$/;

    return BasicVal;
}).call();

    FieldVal.BasicVal = BasicVal;

    return FieldVal;
}).call();

/* istanbul ignore else */
if ('undefined' !== typeof module) {
    module.exports = FieldVal;
}