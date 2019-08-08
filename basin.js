class Basin{
    constructor(load,opts/*,year,SHem,godMode,hyper,seed,names,hurrTerm,mapType*/){
        if(!opts) opts = {};
        this.seasons = {};
        this.seasonsBusyLoading = {};
        this.seasonExpirationTimers = {};
        this.activeSystems = [];
        this.tick = 0;
        this.lastSaved = 0;
        this.godMode = opts.godMode;
        this.SHem = opts.hem;
        this.actMode = opts.actMode || 0;
        this.hypoCats = opts.hypoCats;
        this.startYear = opts.year || (this.SHem ? SHEM_DEFAULT_YEAR : NHEM_DEFAULT_YEAR);
        this.nameList = NAME_LIST_PRESETS[opts.names || 0];
        this.sequentialNameIndex = typeof this.nameList[0] === "string" ? 0 : -1;
        this.hurricaneStrengthTerm = opts.hurrTerm || 0;
        this.mapType = opts.mapType || 0;
        this.seed = opts.seed || moment().valueOf();
        this.envData = {};
        this.envData.loadData = [];
        this.env = new Environment(this);
        this.saveName = load || AUTOSAVE_SAVE_NAME;
        if(load) this.initialized = this.load();
        else{
            Basin.deleteSave(AUTOSAVE_SAVE_NAME);
            let f = ()=>{
                noiseSeed(this.seed);
                this.env.init();
                land = new Land(this);
                this.seasons[this.getSeason(-1)] = new Season(this);
                this.env.record();
            };
            if(MAP_TYPES[this.mapType].form==='pixelmap'){
                this.initialized = loadImg(MAP_TYPES[this.mapType].path).then(img=>{
                    img.loadPixels();
                    this.mapImg = img;
                    f();
                    return this;
                }).catch(e=>{
                    console.error(e);
                });
            }else{
                f();
                this.initialized = Promise.resolve(this);
            }
        }
    }

    mount(){    // mounts the basin to the viewer
        viewTick = this.tick;
        UI.viewBasin = this;
        selectedStorm = undefined;
        paused = this.tick!==0;
        refreshTracks(true);
        primaryWrapper.show();
        renderToDo = land.draw();
    }

    advanceSim(){
        let vp = this.viewingPresent();
        let os = this.getSeason(-1);
        this.tick++;
        let vs = this.getSeason(viewTick);
        viewTick = this.tick;
        let curSeason = this.getSeason(-1);
        if(curSeason!==os){
            let e = new Season(this);
            for(let s of this.activeSystems) e.addSystem(new StormRef(this,s.fetchStorm()));
            this.seasons[curSeason] = e;
        }
        if(!vp || curSeason!==vs) refreshTracks(curSeason!==vs);
        this.env.wobble();    // random change in environment for future forecast realism
        for(let i=0;i<this.activeSystems.length;i++){
            for(let j=i+1;j<this.activeSystems.length;j++){
                this.activeSystems[i].interact(this.activeSystems[j],true);
            }
            this.activeSystems[i].update();
        }
        if(this.actMode===ACTIVITY_MODE_NORMAL && random()<0.015*sq((seasonalSine(this.tick)+1)/2)) this.spawn(false);    // tropical waves (normal mode)
        if((this.actMode===ACTIVITY_MODE_HYPER || this.actMode===ACTIVITY_MODE_MEGABLOBS) && random()<(0.013*sq((seasonalSine(this.tick)+1)/2)+0.002)) this.spawn(false);    // tropical waves (hyper and megablobs modes)
        if(this.actMode===ACTIVITY_MODE_WILD && random()<0.015) this.spawn(false,{x:random(0,WIDTH),y:random(0.2*HEIGHT,0.9*HEIGHT),sType:'l'}); // tropical waves (wild mode)
        if(random()<0.01-0.002*seasonalSine(this.tick)) this.spawn(true);    // extratropical cyclones
        let stormKilled = false;
        for(let i=this.activeSystems.length-1;i>=0;i--){
            if(!this.activeSystems[i].fetchStorm().current){
                this.activeSystems.splice(i,1);
                stormKilled = true;
            }
        }
        if(stormKilled) refreshTracks();
        if(this.tick%ADVISORY_TICKS==0){
            this.env.displayLayer();
            this.env.record();
        }else if(simSettings.showMagGlass) this.env.updateMagGlass();
        let curTime = this.tickMoment();
        if(simSettings.doAutosave && /* !storageQuotaExhausted && */ (curTime.date()===1 || curTime.date()===15) && curTime.hour()===0) this.save();
    }

    startTime(){
        let y = this.startYear;
        let mo = moment.utc([y]);
        if(this.SHem){
            mo.month(6);
            mo.year(y-1);
        }
        return mo.valueOf();
    }

    tickMoment(t){
        if(t===undefined) t = this.tick;
        return moment.utc(this.startTime()+t*TICK_DURATION);
    }

    tickFromMoment(m){
        if(m instanceof moment) return floor((m.valueOf()-this.startTime())/TICK_DURATION);
    }

    seasonTick(n){
        if(n===undefined) n = this.getSeason(-1);
        let m = moment.utc(this.SHem ? [n-1, 6, 1] : [n, 0, 1]);
        let t = floor((m.valueOf()-this.startTime())/TICK_DURATION);
        t = floor(t/ADVISORY_TICKS)*ADVISORY_TICKS;
        return t;
    }

    viewingPresent(){
        return viewTick === this.tick;
    }

    hem(v){
        return this.SHem ? -v : v;
    }

    hemY(y){
        return this.SHem ? HEIGHT-y : y;
    }

    spawn(...opts){
        this.activeSystems.push(new ActiveSystem(this,...opts));
    }

    getNewName(season,sNum){
        let list;
        if(this.sequentialNameIndex<0){
            let numoflists = this.nameList.length-1;
            list = this.nameList[(season+1)%numoflists];
            if(sNum>=list.length){
                let gNum = sNum-list.length;
                let greeks = this.nameList[numoflists];
                if(gNum>=greeks.length) return "Unnamed";
                return greeks[gNum];
            }
            return list[sNum];
        }
        return this.nameList[sNum];
    }

    getSeason(t){       // returns the year number of a season given a sim tick
        if(t===-1) t = this.tick;
        if(this.SHem){
            let tm = this.tickMoment(t);
            let m = tm.month();
            let y = tm.year();
            if(m>=6) return y+1;
            return y;
        }
        return this.tickMoment(t).year();
    }

    fetchSeason(n,isTick,loadedRequired,callback){  // returns the season object given a year number, or given a sim tick if isTick is true
        if(isTick) n = this.getSeason(n);
        let season;
        let promise;
        if(this.seasons[n]){
            season = this.seasons[n];
            promise = Promise.resolve(season);
        }else{
            if(this.seasonsBusyLoading[n]) promise = this.seasonsBusyLoading[n];
            else{
                promise = this.seasonsBusyLoading[n] = waitForAsyncProcess(()=>{
                    return db.seasons.where('[saveName+season]').equals([this.saveName,n]).last().then(res=>{
                        if(res){
                            let d = LoadData.wrap(res);
                            let seas = this.seasons[n] = new Season(this,d);
                            this.expireSeasonTimer(n);
                            this.seasonsBusyLoading[n] = undefined;
                            seas.lastAccessed = moment().valueOf();
                            return seas;
                        }else return undefined;
                    });
                },'Retrieving Season...');
                //makeAsyncProcess,'Retrieving Season...',()=>{
                //     let sKey = this.storagePrefix() + LOCALSTORAGE_KEY_SEASON + n;
                //     let str = localStorage.getItem(sKey);
                //     if(str){
                //         let seas = this.seasons[n] = new Season({format:FORMAT_WITH_SAVED_SEASONS,value:str});
                //         this.expireSeasonTimer(n);
                //         this.seasonsBusyLoading[n] = undefined;
                //         seas.lastAccessed = moment().valueOf();
                //         return seas;
                //     }else return undefined;
                // });
            }
        }
        if(season) season.lastAccessed = moment().valueOf();
        else if(loadedRequired) throw new Error(LOADED_SEASON_REQUIRED_ERROR);
        if(callback instanceof Function) promise.then(callback);
        else if(callback) return promise;
        return season;
    }

    seasonUnloadable(n){
        n = parseInt(n);
        if(!this.seasons[n]) return false;
        let s = this.seasons[n];
        let v = this.getSeason(viewTick);
        for(let a of this.activeSystems) if(a.fetchStorm().originSeason()===n) return false;
        return !s.modified && n!==v && n!==v-1 && n!==this.getSeason(-1);
    }
    
    expireSeasonTimer(n){
        let f = ()=>{
            if(this.seasons[n]){
                if(moment().diff(this.seasons[n].lastAccessed)>=LOADED_SEASON_EXPIRATION && this.seasonUnloadable(n)) this.seasons[n] = undefined;
                else this.expireSeasonTimer(n);
            }
        };
        this.seasonExpirationTimers[n] = setTimeout(f,LOADED_SEASON_EXPIRATION);
    }

    // static storagePrefix(s){    // legacy
    //     return LOCALSTORAGE_KEY_PREFIX + LOCALSTORAGE_KEY_SAVEDBASIN + s + '-';
    // }

    // storagePrefix(){    // legacy
    //     return Basin.storagePrefix(this.saveSlot);
    // }

    save(){
        let reqSeasons = [];
        for(let k in this.seasons){
            if(this.seasons[k] && this.seasons[k].modified){
                let seas = this.seasons[k];
                for(let i=0;i<seas.systems.length;i++){
                    if(seas.systems[i] instanceof StormRef){
                        reqSeasons.push(this.fetchSeason(seas.systems[i].season,false,false,true));
                    }
                }
            }
        }
        return Promise.all(reqSeasons).then(()=>{
            // console.log('basin not saved for testing purposes');

            // new indexedDB saving & Format 2

            let obj = {};
            obj.format = SAVE_FORMAT;
            let b = obj.value = {};
            b.activeSystems = [];
            for(let a of this.activeSystems){
                b.activeSystems.push(a.save());
            }
            b.envData = [];
            for(let i=this.env.fieldList.length-1;i>=0;i--){
                let f = this.env.fieldList[i];
                for(let j=this.env.fields[f].noise.length-1;j>=0;j--){
                    b.envData.push(this.envData[f][j].save());
                }
            }
            b.flags = 0;
            b.flags |= 0;   // former hyper mode
            b.flags <<= 1;
            b.flags |= this.godMode;
            b.flags <<= 1;
            b.flags |= this.SHem;
            for(let p of [
                'mapType',
                'hurricaneStrengthTerm',
                'sequentialNameIndex',
                'tick',
                'seed',
                'startYear',
                'nameList',
                'hypoCats',
                'actMode'
            ]) b[p] = this[p];
            return db.transaction('rw',db.saves,db.seasons,()=>{
                db.saves.put(obj,this.saveName);
                for(let k in this.seasons){
                    if(this.seasons[k] && this.seasons[k].modified){
                        let seas = {};
                        seas.format = SAVE_FORMAT;
                        seas.saveName = this.saveName;
                        seas.season = parseInt(k);
                        seas.value = this.seasons[k].save();
                        let cur = db.seasons.where('[saveName+season]').equals([this.saveName,seas.season]);
                        cur.count().then(c=>{
                            if(c>1){
                                cur.delete().then(()=>{
                                    db.seasons.put(seas);
                                });
                            }else if(c===1) cur.modify((s,ref)=>{
                                ref.value = seas;
                            });
                            else db.seasons.put(seas);
                        });
                    }
                }
            }).then(()=>{
                this.lastSaved = this.tick;
                for(let k in this.seasons){
                    if(this.seasons[k]) this.seasons[k].modified = false;
                }
            });

            // old localStorage save code (Format 1) (defunct)

            // let lastSaved = this.lastSaved;
            // let savedSeasons = [];
            // modifyLocalStorage(()=>{
            //     let formatKey = this.storagePrefix() + LOCALSTORAGE_KEY_FORMAT;
            //     let basinKey = this.storagePrefix() + LOCALSTORAGE_KEY_BASIN;
            //     let namesKey = this.storagePrefix() + LOCALSTORAGE_KEY_NAMES;
            //     localStorage.setItem(formatKey,SAVE_FORMAT.toString(SAVING_RADIX));
            //     let str = "";
            //     for(let i=this.activeSystems.length-1;i>=0;i--){
            //         str += this.activeSystems[i].save();
            //         if(i>0) str += ",";
            //     }
            //     str += ";";
            //     for(let i=Env.fieldList.length-1;i>=0;i--){
            //         let f = Env.fieldList[i];
            //         for(let j=Env.fields[f].noise.length-1;j>=0;j--){
            //             str += this.envData[f][j].save();
            //             if(i>0 || j>0) str += ",";
            //         }
            //     }
            //     str += ";";
            //     let flags = 0;
            //     flags |= this.hyper;
            //     flags <<= 1;
            //     flags |= this.godMode;
            //     flags <<= 1;
            //     flags |= this.SHem;
            //     let arr = [this.mapType,this.hurricaneStrengthTerm,this.sequentialNameIndex,this.tick,this.seed,this.startYear,flags]; // add new properties to the beginning of this array for backwards compatibility
            //     str += encodeB36StringArray(arr);
            //     localStorage.setItem(basinKey,str);
            //     let names = this.nameList.join(";");
            //     if(typeof this.nameList[0]==="object" && this.nameList[0].length<2) names = "," + names;
            //     localStorage.setItem(namesKey,names);
            //     for(let k in this.seasons){
            //         if(this.seasons[k] && this.seasons[k].modified){
            //             let seasonKey = this.storagePrefix() + LOCALSTORAGE_KEY_SEASON + k;
            //             savedSeasons.push(k);
            //             localStorage.setItem(seasonKey,this.seasons[k].save());
            //         }
            //     }
            //     this.lastSaved = this.tick;
            // },()=>{
            //     this.lastSaved = lastSaved;
            //     for(let k of savedSeasons) this.seasons[k].modified = true;
            //     alert("localStorage quota for origin " + origin + " exceeded; unable to save");
            // });
        }).catch(e=>{
            console.warn("Could not save due to an error");
            console.error(e);
        });
    }

    load(){
        return waitForAsyncProcess(()=>{
            return db.saves.get(this.saveName).then(res=>{
                if(res && res.format>=EARLIEST_COMPATIBLE_FORMAT){
                    let data = LoadData.wrap(res);
                    let oldhyper;
                    if(data.format>=FORMAT_WITH_INDEXEDDB){
                        let obj = data.value;
                        for(let a of obj.activeSystems){
                            this.activeSystems.push(new ActiveSystem(this,data.sub(a)));
                        }
                        this.envData.loadData = data.sub(obj.envData);
                        let flags = obj.flags;
                        this.SHem = flags & 1;
                        flags >>= 1;
                        this.godMode = flags & 1;
                        flags >>= 1;
                        oldhyper = flags & 1;
                        for(let p of [
                            'mapType',
                            'hurricaneStrengthTerm',
                            'sequentialNameIndex',
                            'tick',
                            'seed',
                            'startYear',
                            'nameList',
                            'hypoCats',
                            'actMode'
                        ]) this[p] = obj[p];
                        this.lastSaved = this.tick;
                    }else{  // Format 1 backwards compatibility
                        // let basinKey = this.storagePrefix() + LOCALSTORAGE_KEY_BASIN;
                        // let formatKey = this.storagePrefix() + LOCALSTORAGE_KEY_FORMAT;
                        // let namesKey = this.storagePrefix() + LOCALSTORAGE_KEY_NAMES;
                        let str = data.value.str;// localStorage.getItem(basinKey);
                        let format = data.format;// parseInt(localStorage.getItem(formatKey),SAVING_RADIX);
                        let names = data.value.names;// localStorage.getItem(namesKey);
                        if(str){
                            let parts = str.split(";");
                            let arr = decodeB36StringArray(parts.pop());
                            let flags = arr.pop() || 0;
                            this.startYear = arr.pop();
                            this.seed = arr.pop() || moment().valueOf();
                            this.lastSaved = this.tick = arr.pop() || 0;
                            this.sequentialNameIndex = arr.pop();
                            this.hurricaneStrengthTerm = arr.pop() || 0;
                            this.mapType = arr.pop() || 0;
                            this.SHem = flags & 1;
                            flags >>= 1;
                            this.godMode = flags & 1;
                            flags >>= 1;
                            oldhyper = flags & 1;
                            if(this.startYear===undefined) this.startYear = this.SHem ? SHEM_DEFAULT_YEAR : NHEM_DEFAULT_YEAR;
                            if(names){
                                names = names.split(";");
                                if(names[0].indexOf(",")>-1){
                                    for(let i=0;i<names.length;i++){
                                        names[i] = names[i].split(",");
                                    }
                                    if(names[0][0]==="") names[0].shift();
                                }
                                this.nameList = names;
                            }
                            if(this.sequentialNameIndex===undefined) this.sequentialNameIndex = typeof this.nameList[0] === "string" ? 0 : -1;
                            let envLoadData = parts.pop();
                            if(envLoadData) this.envData.loadData = data.sub(envLoadData.split(','));
                            let activeSystemData = parts.pop();
                            if(activeSystemData){
                                activeSystemData = activeSystemData.split(",");
                                while(activeSystemData.length>0) this.activeSystems.push(new ActiveSystem(this,data.sub(activeSystemData.pop())));
                            }
                            if(format<FORMAT_WITH_SAVED_SEASONS) this.lastSaved = this.tick = 0; // resets tick to 0 in basins test-saved in versions prior to full saving including seasons added
                        }
                    }
                    if(this.actMode===undefined){
                        if(oldhyper) this.actMode = ACTIVITY_MODE_HYPER;
                        else this.actMode = ACTIVITY_MODE_NORMAL;
                    }
                }else{
                    let t = 'Could not load basin';
                    console.error(t);
                    alert(t);
                }
                return this;
            }).then(b=>{
                if(MAP_TYPES[b.mapType].form==='pixelmap'){
                    return loadImg(MAP_TYPES[b.mapType].path).then(img=>{
                        img.loadPixels();
                        b.mapImg = img;
                        return b;
                    });
                }
                return b;
            }).then(b=>{
                noiseSeed(b.seed);
                // Environment.init(b);
                b.env.init();
                land = new Land(b);
                return b.fetchSeason(-1,true,false,true).then(s=>{
                    let arr = [];
                    for(let i=0;i<s.systems.length;i++){
                        let r = s.systems[i];
                        if(r instanceof StormRef && (r.lastApplicableAt===undefined || r.lastApplicableAt>=b.tick || simSettings.trackMode===2)){
                            arr.push(b.fetchSeason(r.season,false,false,true));
                        }
                    }
                    return Promise.all(arr);
                });
            }).then(()=>this);
        },'Loading Basin...').catch(e=>{
            console.error(e);
        });
    }

    saveAs(newName){
        let oldName = this.saveName;
        return Basin.deleteSave(newName,()=>{
            return db.transaction('rw',db.saves,db.seasons,()=>{
                db.saves.get(oldName).then(res=>{
                    db.saves.put(res,newName);
                });
                db.seasons.where('saveName').equals(oldName).modify(v=>{
                    db.seasons.put({
                        format: v.format,
                        saveName: newName,
                        season: v.season,
                        value: v.value
                    });
                });
            }).then(()=>{
                this.saveName = newName;
                this.save();
            });
        });

        // let oldPre = this.storagePrefix();
        // let newPre = Basin.storagePrefix(newSlot);
        // modifyLocalStorage(()=>{
        //     Basin.deleteSave(newSlot);
        //     for(let i=0;i<localStorage.length;i++){
        //         let k = localStorage.key(i);
        //         if(k.startsWith(oldPre)){
        //             let suffix = k.slice(oldPre.length);
        //             localStorage.setItem(newPre+suffix,localStorage.getItem(k));
        //         }
        //     }
        // },()=>{
        //     newSlot = this.saveSlot;
        // },()=>{
        //     this.saveSlot = newSlot;
        //     this.save();
        // });
    }

    static deleteSave(name,callback){
        return db.transaction('rw',db.saves,db.seasons,()=>{
            db.saves.delete(name);
            db.seasons.where('saveName').equals(name).delete();
        }).then(callback).catch(e=>{
            console.error(e);
        });
    }
}

class Season{
    constructor(basin,loaddata){
        if(basin instanceof Basin) this.basin = basin;
        this.systems = [];
        this.envData = {};
        this.idSystemCache = {};
        this.totalSystemCount = 0;
        this.depressions = 0;
        this.namedStorms = 0;
        this.hurricanes = 0;
        this.majors = 0;
        this.c5s = 0;
        this.c8s = 0;
        this.hypercanes = 0;
        this.ACE = 0;
        this.deaths = 0;
        this.damage = 0;
        this.envRecordStarts = 0;
        this.modified = true;
        this.lastAccessed = moment().valueOf();
        if(loaddata instanceof LoadData) this.load(loaddata);
    }

    addSystem(s){
        this.systems.push(s);
        if(s.current) s.id = this.totalSystemCount++;
        this.modified = true;
    }

    fetchSystemById(id){
        if(this.idSystemCache[id]) return this.idSystemCache[id];
        for(let i=0;i<this.systems.length;i++){
            let s = this.systems[i];
            if(s.id===id){
                this.idSystemCache[id] = s;
                return s;
            }
        }
        return null;
    }

    fetchSystemAtIndex(i,lazy){
        if(this.systems[i] instanceof StormRef){
            if(lazy){
                let r = this.systems[i];
                if(r.lastApplicableAt===undefined || r.lastApplicableAt>=viewTick || simSettings.trackMode===2) return r.fetch();
                return undefined;
            }else return this.systems[i].fetch();
        }
        return this.systems[i];
    }

    *forSystems(lazy){
        for(let i=0;i<this.systems.length;i++){
            let s = this.fetchSystemAtIndex(i,lazy);
            if(s) yield s;
        }
    }

    save(forceStormRefs){
        // new save format

        let basin = this.basin;
        let val = {};
        for(let p of [
            'totalSystemCount',
            'depressions',
            'namedStorms',
            'hurricanes',
            'majors',
            'c5s',
            'c8s',
            'hypercanes',
            'ACE',
            'deaths',
            'damage',
            'envRecordStarts'
        ]) val[p] = this[p];
        val.envData = {};
        for(let f of basin.env.fieldList){
            let fd = val.envData[f] = {};
            for(let i=0;i<basin.env.fields[f].noise.length;i++){
                let nd = fd[i] = {};
                let x = [];
                let y = [];
                let z = [];
                for(let e of this.envData[f][i]){
                    x.push(e.x);
                    y.push(e.y);
                    z.push(e.z);
                }
                nd.x = new Float32Array(x);
                nd.y = new Float32Array(y);
                nd.z = new Float32Array(z);
            }
        }
        val.systems = [];
        for(let i=0;i<this.systems.length;i++){
            let s = this.systems[i];
            if(s instanceof StormRef && (forceStormRefs || s.fetch() && (s.fetch().TC || s.fetch().current))){
                val.systems.push({isRef:true,val:s.save()});
            }else if(s.TC || s.current){
                val.systems.push({isRef:false,val:s.save()});
            }
        }
        return val;

        // old save format

        // let str = "";
        // let stats = [];
        // stats.push(this.totalSystemCount);
        // stats.push(this.depressions);
        // stats.push(this.namedStorms);
        // stats.push(this.hurricanes);
        // stats.push(this.majors);
        // stats.push(this.c5s);
        // stats.push(this.ACE*ACE_DIVISOR);
        // stats.push(this.deaths);
        // stats.push(this.damage/DAMAGE_DIVISOR);
        // stats.push(this.envRecordStarts);
        // stats.push(SAVE_FORMAT);
        // str += encodeB36StringArray(stats);
        // str += ";";
        // if(this.envData){
        //     let mapR = r=>n=>map(n,-r,r,0,ENVDATA_SAVE_MULT);
        //     for(let f of Env.fieldList){
        //         for(let i=0;i<Env.fields[f].noise.length;i++){
        //             let a = this.envData[f][i];
        //             let c = Env.fields[f].noise[i];
        //             let k = a[0];
        //             let m = a.slice(1);
        //             k = [k.x,k.y,k.z];
        //             str += encodeB36StringArray(k,ENVDATA_SAVE_FLOAT);
        //             str += ".";
        //             let opts = {};
        //             opts.h = opts.w = ENVDATA_SAVE_MULT;
        //             let xyrange = (c.wobbleMax/c.zoom)*ADVISORY_TICKS;
        //             let zrange = (c.zWobbleMax/c.zZoom)*ADVISORY_TICKS;
        //             opts.mapY = opts.mapX = mapR(xyrange);
        //             opts.mapZ = mapR(zrange);
        //             str += encodePointArray(m,opts);
        //             str += ",";
        //         }
        //     }
        // }else str += ";";
        // if(str.charAt(str.length-1)===",") str = str.slice(0,str.length-1) + ";";
        // for(let i=0;i<this.systems.length;i++){
        //     let s = this.systems[i];
        //     if(s instanceof StormRef && s.fetch() && (s.fetch().TC || s.fetch().current)){
        //         str += "~" + s.save();
        //     }else if(s.TC || s.current){
        //         str += "," + s.save();
        //     }
        // }
        // this.modified = false;
        // return str;
    }

    load(data){
        let basin = this.basin;
        if(data instanceof LoadData && data.format>=EARLIEST_COMPATIBLE_FORMAT){
            if(data.format>=FORMAT_WITH_INDEXEDDB){
                let obj = data.value;
                for(let p of [
                    'totalSystemCount',
                    'depressions',
                    'namedStorms',
                    'hurricanes',
                    'majors',
                    'c5s',
                    'c8s',
                    'hypercanes',
                    'ACE',
                    'deaths',
                    'damage',
                    'envRecordStarts'
                ]) this[p] = obj[p] || 0;
                for(let f of basin.env.fieldList){
                    let fd = this.envData[f] = {};
                    for(let i=0;i<basin.env.fields[f].noise.length;i++){
                        let nd = fd[i] = [];
                        let sd = obj.envData[f][i];
                        let x = [...sd.x];
                        let y = [...sd.y];
                        let z = [...sd.z];
                        for(let j=0;j<x.length;j++){
                            nd.push({
                                x: x[j],
                                y: y[j],
                                z: z[j]
                            });
                        }
                    }
                }
                for(let i=0;i<obj.systems.length;i++){
                    let s = obj.systems[i];
                    if(s.isRef) this.systems.push(new StormRef(basin,data.sub(s.val)));
                    else{
                        let v = data.sub(s.val);
                        v.season = data.season;
                        this.systems.push(new Storm(basin,v));
                    }
                }
            }else{  // Format 1 backwards compatibility
                let str = data.value;
                let mainparts = str.split(";");
                let stats = decodeB36StringArray(mainparts[0]);
                data.format = stats.pop();
                if(data.format===undefined){
                    this.envData = null;
                    return;
                }
                this.envRecordStarts = stats.pop() || 0;
                this.damage = stats.pop()*DAMAGE_DIVISOR || 0;
                this.deaths = stats.pop() || 0;
                this.ACE = stats.pop()/ACE_DIVISOR || 0;
                this.c5s = stats.pop() || 0;
                this.majors = stats.pop() || 0;
                this.hurricanes = stats.pop() || 0;
                this.namedStorms = stats.pop() || 0;
                this.depressions = stats.pop() || 0;
                this.totalSystemCount = stats.pop() || 0;
                if(data.format>=ENVDATA_COMPATIBLE_FORMAT && mainparts[1]!==""){
                    let e = mainparts[1].split(",");
                    let i = 0;
                    let mapR = r=>n=>map(n,0,ENVDATA_SAVE_MULT,-r,r);
                    for(let f of basin.env.fieldList){
                        for(let j=0;j<basin.env.fields[f].noise.length;j++,i++){
                            let c = basin.env.fields[f].noise[j];
                            let s = e[i].split(".");
                            let k = decodeB36StringArray(s[0]);
                            k = {x:k[0],y:k[1],z:k[2]};
                            let opts = {};
                            opts.h = opts.w = ENVDATA_SAVE_MULT;
                            let xyrange = (c.wobbleMax/c.zoom)*ADVISORY_TICKS;
                            let zrange = (c.zWobbleMax/c.zZoom)*ADVISORY_TICKS;
                            opts.mapY = opts.mapX = mapR(xyrange);
                            opts.mapZ = mapR(zrange);
                            let m = decodePointArray(s[1],opts);
                            for(let n=0;n<m.length;n++){
                                let p1;
                                if(n===0) p1 = k;
                                else p1 = m[n-1];
                                let p2 = m[n];
                                m[n] = {
                                    x: p1.x + p2.x,
                                    y: p1.y + p2.y,
                                    z: p1.z + p2.z
                                };
                            }
                            m.unshift(k);
                            if(!this.envData[f]) this.envData[f] = {};
                            this.envData[f][j] = m;
                        }
                    }
                }else this.envData = null;
                let storms = mainparts[2];
                for(let i=0,i1=0;i1<storms.length;i=i1){
                    i1 = storms.slice(i+1).search(/[~,]/g);
                    i1 = i1<0 ? storms.length : i+1+i1;
                    let s = storms.slice(i,i1);
                    if(s.charAt(0)==="~") this.systems.push(new StormRef(basin,data.sub(s.slice(1))));
                    else if(s.charAt(0)===","){
                        let v = data.sub(s.slice(1));
                        v.season = data.season;
                        this.systems.push(new Storm(basin,v));
                    }
                }
            }
            if(data.format===SAVE_FORMAT) this.modified = false;
            else{
                db.transaction('rw',db.seasons,()=>{
                    let seas = {};
                    seas.format = SAVE_FORMAT;
                    seas.saveName = data.saveName;
                    seas.season = data.season;
                    seas.value = this.save(true);
                    let cur = db.seasons.where('[saveName+season]').equals([data.saveName,data.season]);
                    cur.count().then(c=>{
                        if(c>0) cur.modify((s,ref)=>{
                            ref.value = seas;
                        });
                        else db.seasons.put(seas);
                    });
                }).then(()=>{
                    this.modified = false;
                    // console.log('season ' + data.season + ' of "' + data.saveName + '" upgraded to format ' + SAVE_FORMAT);
                }).catch(e=>{
                    console.error(e);
                });
            }
        }else this.envData = null;
    }
}

// saving/loading helpers

function setupDatabase(){
    db = new Dexie("cyclone-sim");
    db.version(1).stores({
        saves: '',
        seasons: '++,saveName,season',
        settings: ''
    });
    db.version(2).stores({
        saves: ',format',
        seasons: '++,format,saveName,[saveName+season]'
    });
}

class LoadData{
    constructor(format,value){
        this.format = format;
        this.value = value;
    }

    sub(v){
        return new LoadData(this.format,v);
    }

    static wrap(obj){
        let d = new LoadData(obj.format,obj.value);
        for(let k in obj){
            if(k!=='format' && k!=='value') d[k] = obj[k];
        }
        return d;
    }
}

// legacy saving/loading helpers (encoders are commented out; decoders aren't for backwards compatibility)

// function encodeB36StringArray(arr,fl){
//     const R = SAVING_RADIX;
//     const numLen = n=>constrain(floor(log(abs(n)/pow(R,fl)*2+(n<0?1:0))/log(R))+1,1,R);
//     if(fl===undefined) fl = 0;
//     if(fl>R/2) fl = 0;
//     if(fl<=-R/2) fl = 0;
//     let str = (fl<0 ? fl+R : fl).toString(R);
//     let nLen;
//     let lenRun;
//     let strpart = "";
//     for(let i=0;i<arr.length;i++){
//         let n = arr[i];
//         let newLen = numLen(n);
//         if(newLen!==nLen || lenRun>=R){
//             if(lenRun!==undefined){
//                 str += ((lenRun-1).toString(R)) + ((nLen-1).toString(R)) + strpart;
//                 strpart = "";
//             }
//             nLen = newLen;
//             lenRun = 1;
//         }else lenRun++;
//         n /= pow(R,fl);
//         n = floor(n);
//         n = n<0 ? abs(n)*2+1 : n*2;
//         n = n.toString(R);
//         if(n.length>R) n = n.slice(0,R);
//         strpart += n;
//     }
//     if(lenRun!==undefined) str += ((lenRun-1).toString(R)) + ((nLen-1).toString(R)) + strpart;
//     return str;
// }

function decodeB36StringArray(str){
    const R = SAVING_RADIX;
    let arr = [];
    let fl = str.slice(0,1);
    fl = parseInt(fl,R);
    if(fl>R/2) fl -= R;
    for(let i=1,runLen=0,run=0,nLen;i<str.length;i+=nLen,run++){
        if(run>=runLen){
            runLen = str.slice(i,++i);
            nLen = str.slice(i,++i);
            runLen = parseInt(runLen,R)+1;
            nLen = parseInt(nLen,R)+1;
            run = 0;
        }
        let n = str.slice(i,i+nLen);
        n = parseInt(n,R);
        n = n%2===0 ? n/2 : -(n-1)/2;
        n *= pow(R,fl);
        arr.push(n);
    }
    return arr;
}

// function encodePoint(x,y,z,o){
//     if(typeof x === "object"){
//         o = y;
//         z = x.z || 0;
//         y = x.y || 0;
//         x = x.x || 0;
//     }else{
//         x = x || 0;
//         y = y || 0;
//         z = z || 0;
//     }
//     if(!o) o = {};
//     let w = floor(o.w || WIDTH);
//     let h = floor(o.h || HEIGHT);
//     if(o.mapX instanceof Function) x = o.mapX(x);
//     if(o.mapY instanceof Function) y = o.mapY(y);
//     if(o.mapZ instanceof Function) z = o.mapZ(z);
//     x = abs(x);
//     y = abs(y);
//     z = abs(z);
//     return floor(z)*w*h+floor(y)*w+floor(x);
// }

function decodePoint(n,o){
    if(!o) o = {};
    let w = floor(o.w || WIDTH);
    let h = floor(o.h || HEIGHT);
    let z = floor(n/(w*h));
    n %= w*h;
    let y = floor(n/w);
    n %= w;
    let x = n;
    if(o.mapX instanceof Function) x = o.mapX(x);
    if(o.mapY instanceof Function) y = o.mapY(y);
    if(o.mapZ instanceof Function) z = o.mapZ(z);
    if(o.p5Vec) return createVector(x,y,z);
    return {x,y,z};
}

// function encodePointArray(a,o){
//     let arr = [];
//     for(let i=0;i<a.length;i++){
//         arr[i] = encodePoint(a[i],o);
//     }
//     return encodeB36StringArray(arr);
// }

function decodePointArray(s,o){
    let arr = decodeB36StringArray(s);
    for(let i=0;i<arr.length;i++){
        arr[i] = decodePoint(arr[i],o);
    }
    return arr;
}

// function modifyLocalStorage(action,error,callback){
//     let lsCache = {};
//     for(let i=0;i<localStorage.length;i++){
//         let k = localStorage.key(i);
//         if(k.startsWith(LOCALSTORAGE_KEY_PREFIX)) lsCache[k] = localStorage.getItem(k);
//     }
//     try{
//         action();
//     }catch(e){
//         for(let i=localStorage.length-1;i>=0;i--){
//             let k = localStorage.key(i);
//             if(k.startsWith(LOCALSTORAGE_KEY_PREFIX)) localStorage.removeItem(k);
//         }
//         for(let k in lsCache){
//             localStorage.setItem(k,lsCache[k]);
//         }
//         storageQuotaExhausted = true;
//         if(error) error(e);
//         else console.error(e);
//         return;
//     }
//     lsCache = undefined;
//     if(callback) callback();
// }