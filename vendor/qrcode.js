/*
  Minimal QR code generator (MIT License)
  Based on Kazuhiko Arase's "qrcode-generator" project (trimmed for this demo).

  Usage:
    const qr = qrcode(0, 'M'); // typeNumber 0 = auto
    qr.addData('hello');
    qr.make();
    qr.getModuleCount();
    qr.isDark(r, c);
*/
(function(global){
  "use strict";

  // Error correction levels
  const QRErrorCorrectLevel = { L:1, M:0, Q:3, H:2 };

  function QRMath(){}
  QRMath.glog = function(n){
    if(n < 1) throw new Error("glog(" + n + ")");
    return QRMath.LOG_TABLE[n];
  };
  QRMath.gexp = function(n){
    while(n < 0) n += 255;
    while(n >= 256) n -= 255;
    return QRMath.EXP_TABLE[n];
  };
  QRMath.EXP_TABLE = new Array(256);
  QRMath.LOG_TABLE = new Array(256);
  for(let i=0;i<8;i++) QRMath.EXP_TABLE[i] = 1 << i;
  for(let i=8;i<256;i++) QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i-4] ^ QRMath.EXP_TABLE[i-5] ^ QRMath.EXP_TABLE[i-6] ^ QRMath.EXP_TABLE[i-8];
  for(let i=0;i<255;i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

  function QRPolynomial(num, shift){
    if(num.length === undefined) throw new Error(num.length + "/undefined");
    let offset = 0;
    while(offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + (shift||0));
    for(let i=0;i<num.length-offset;i++) this.num[i] = num[i+offset];
  }
  QRPolynomial.prototype = {
    get: function(index){ return this.num[index]; },
    getLength: function(){ return this.num.length; },
    multiply: function(e){
      const num = new Array(this.getLength() + e.getLength() - 1);
      for(let i=0;i<num.length;i++) num[i] = 0;
      for(let i=0;i<this.getLength();i++){
        for(let j=0;j<e.getLength();j++){
          num[i+j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
        }
      }
      return new QRPolynomial(num, 0);
    },
    mod: function(e){
      if(this.getLength() - e.getLength() < 0) return this;
      const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
      const num = this.num.slice();
      for(let i=0;i<e.getLength();i++){
        num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
      }
      return new QRPolynomial(num, 0).mod(e);
    }
  };

  function QRBitBuffer(){
    this.buffer = [];
    this.length = 0;
  }
  QRBitBuffer.prototype = {
    get: function(index){
      const bufIndex = Math.floor(index / 8);
      return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) === 1;
    },
    put: function(num, length){
      for(let i=0;i<length;i++){
        this.putBit(((num >>> (length - i - 1)) & 1) === 1);
      }
    },
    putBit: function(bit){
      const bufIndex = Math.floor(this.length / 8);
      if(this.buffer.length <= bufIndex) this.buffer.push(0);
      if(bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
      this.length++;
    },
    getLengthInBits: function(){ return this.length; }
  };

  // 8-bit bytes mode only (sufficient for this app)
  function QR8bitByte(data){
    this.mode = 1 << 2; // MODE_8BIT_BYTE
    this.data = data;
  }
  QR8bitByte.prototype = {
    getLength: function(){ return this.data.length; },
    write: function(buffer){
      for(let i=0;i<this.data.length;i++){
        buffer.put(this.data.charCodeAt(i), 8);
      }
    }
  };

  const QRUtil = {
    PATTERN_POSITION_TABLE: [
      [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
      [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
      [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
      [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ],
    G15: (1<<10) | (1<<8) | (1<<5) | (1<<4) | (1<<2) | (1<<1) | (1<<0),
    G18: (1<<12) | (1<<11) | (1<<10) | (1<<9) | (1<<8) | (1<<5) | (1<<2) | (1<<0),
    G15_MASK: (1<<14) | (1<<12) | (1<<10) | (1<<4) | (1<<1),
    getBCHTypeInfo: function(data){
      let d = data << 10;
      while(QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0){
        d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15)));
      }
      return ((data << 10) | d) ^ QRUtil.G15_MASK;
    },
    getBCHTypeNumber: function(data){
      let d = data << 12;
      while(QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0){
        d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18)));
      }
      return (data << 12) | d;
    },
    getBCHDigit: function(data){
      let digit = 0;
      while(data !== 0){ digit++; data >>>= 1; }
      return digit;
    },
    getPatternPosition: function(typeNumber){
      return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
    },
    getMask: function(maskPattern, i, j){
      switch(maskPattern){
        case 0: return (i + j) % 2 === 0;
        case 1: return i % 2 === 0;
        case 2: return j % 3 === 0;
        case 3: return (i + j) % 3 === 0;
        case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case 5: return (i * j) % 2 + (i * j) % 3 === 0;
        case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
        case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
        default: throw new Error("bad maskPattern:" + maskPattern);
      }
    },
    getErrorCorrectPolynomial: function(errorCorrectLength){
      let a = new QRPolynomial([1], 0);
      for(let i=0;i<errorCorrectLength;i++){
        a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
      }
      return a;
    },
    getLengthInBits: function(typeNumber){
      // 8-bit mode only
      if(typeNumber >= 1 && typeNumber < 10) return 8;
      if(typeNumber < 27) return 16;
      return 16;
    }
  };

  // RS blocks (limited table up to type 10, enough for small payloads)
  // Format: [count, totalCount, dataCount] repeated.
  const RS_BLOCK_TABLE = {
    // typeNumber: {L,M,Q,H}
    1: {L:[[1,26,19]], M:[[1,26,16]], Q:[[1,26,13]], H:[[1,26,9]]},
    2: {L:[[1,44,34]], M:[[1,44,28]], Q:[[1,44,22]], H:[[1,44,16]]},
    3: {L:[[1,70,55]], M:[[1,70,44]], Q:[[2,35,17]], H:[[2,35,13]]},
    4: {L:[[1,100,80]], M:[[2,50,32]], Q:[[2,50,24]], H:[[4,25,9]]},
    5: {L:[[1,134,108]], M:[[2,67,43]], Q:[[2,33,15],[2,34,16]], H:[[2,33,11],[2,34,12]]},
    6: {L:[[2,86,68]], M:[[4,43,27]], Q:[[4,43,19]], H:[[4,43,15]]},
    7: {L:[[2,98,78]], M:[[4,49,31]], Q:[[2,32,14],[4,33,15]], H:[[4,39,13],[1,40,14]]},
    8: {L:[[2,121,97]], M:[[2,60,38],[2,61,39]], Q:[[4,40,18],[2,41,19]], H:[[4,40,14],[2,41,15]]},
    9: {L:[[2,146,116]], M:[[3,58,36],[2,59,37]], Q:[[4,36,16],[4,37,17]], H:[[4,36,12],[4,37,13]]},
    10:{L:[[2,174,138]], M:[[4,69,43],[1,70,44]], Q:[[6,43,19],[2,44,20]], H:[[6,43,15],[2,44,16]]}
  };

  function QRRSBlock(totalCount, dataCount){
    this.totalCount = totalCount;
    this.dataCount = dataCount;
  }
  QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectionLevel){
    const lev = (errorCorrectionLevel || 'M').toUpperCase();
    const row = (RS_BLOCK_TABLE[typeNumber] || RS_BLOCK_TABLE[10])[lev];
    if(!row) throw new Error("bad rs block for type=" + typeNumber + " ec=" + lev);
    const list = [];
    row.forEach((triple)=>{
      const count = triple[0], total = triple[1], data = triple[2];
      for(let i=0;i<count;i++) list.push(new QRRSBlock(total, data));
    });
    return list;
  };

  function qrcode(typeNumber, errorCorrectionLevel){
    const qr = {
      typeNumber: typeNumber || 0,
      errorCorrectionLevel: (errorCorrectionLevel || 'M').toUpperCase(),
      modules: null,
      moduleCount: 0,
      dataCache: null,
      dataList: [],
      addData: function(data){
        this.dataList.push(new QR8bitByte(String(data)));
        this.dataCache = null;
      },
      isDark: function(row, col){
        if(this.modules[row][col] !== null) return this.modules[row][col];
        return false;
      },
      getModuleCount: function(){ return this.moduleCount; },
      make: function(){
        if(this.typeNumber < 1){
          this.typeNumber = this._getBestType();
        }
        this._makeImpl(false, this._getBestMaskPattern());
      },
      _getBestType: function(){
        for(let t=1;t<=10;t++){
          const rsBlocks = QRRSBlock.getRSBlocks(t, this.errorCorrectionLevel);
          const buffer = new QRBitBuffer();
          for(const d of this.dataList){
            buffer.put(d.mode, 4);
            buffer.put(d.getLength(), QRUtil.getLengthInBits(t));
            d.write(buffer);
          }
          const totalDataCount = rsBlocks.reduce((a,b)=> a + b.dataCount, 0);
          if(buffer.getLengthInBits() <= totalDataCount * 8) return t;
        }
        return 10;
      },
      _getBestMaskPattern: function(){
        let minLostPoint = Infinity;
        let pattern = 0;
        for(let i=0;i<8;i++){
          this._makeImpl(true, i);
          const lostPoint = this._getLostPoint();
          if(lostPoint < minLostPoint){
            minLostPoint = lostPoint;
            pattern = i;
          }
        }
        return pattern;
      },
      _makeImpl: function(test, maskPattern){
        this.moduleCount = this.typeNumber * 4 + 17;
        this.modules = new Array(this.moduleCount);
        for(let row=0; row<this.moduleCount; row++){
          this.modules[row] = new Array(this.moduleCount);
          for(let col=0; col<this.moduleCount; col++) this.modules[row][col] = null;
        }
        this._setupPositionProbePattern(0,0);
        this._setupPositionProbePattern(this.moduleCount - 7, 0);
        this._setupPositionProbePattern(0, this.moduleCount - 7);
        this._setupPositionAdjustPattern();
        this._setupTimingPattern();
        this._setupTypeInfo(test, maskPattern);
        if(this.typeNumber >= 7) this._setupTypeNumber(test);
        if(this.dataCache === null) this.dataCache = this._createData();
        this._mapData(this.dataCache, maskPattern);
      },
      _setupPositionProbePattern: function(row, col){
        for(let r=-1; r<=7; r++){
          if(row + r <= -1 || this.moduleCount <= row + r) continue;
          for(let c=-1; c<=7; c++){
            if(col + c <= -1 || this.moduleCount <= col + c) continue;
            if((0 <= r && r <= 6 && (c === 0 || c === 6)) ||
               (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
               (2 <= r && r <= 4 && 2 <= c && c <= 4)){
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      },
      _setupTimingPattern: function(){
        for(let i=8; i<this.moduleCount-8; i++){
          if(this.modules[i][6] === null) this.modules[i][6] = (i % 2 === 0);
          if(this.modules[6][i] === null) this.modules[6][i] = (i % 2 === 0);
        }
      },
      _setupPositionAdjustPattern: function(){
        const pos = QRUtil.getPatternPosition(this.typeNumber);
        for(let i=0;i<pos.length;i++){
          for(let j=0;j<pos.length;j++){
            const row = pos[i], col = pos[j];
            if(this.modules[row][col] !== null) continue;
            for(let r=-2;r<=2;r++){
              for(let c=-2;c<=2;c++){
                if(r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)){
                  this.modules[row + r][col + c] = true;
                } else {
                  this.modules[row + r][col + c] = false;
                }
              }
            }
          }
        }
      },
      _setupTypeNumber: function(test){
        const bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        for(let i=0;i<18;i++){
          const mod = (!test && ((bits >> i) & 1) === 1);
          this.modules[Math.floor(i/3)][i%3 + this.moduleCount - 8 - 3] = mod;
          this.modules[i%3 + this.moduleCount - 8 - 3][Math.floor(i/3)] = mod;
        }
      },
      _setupTypeInfo: function(test, maskPattern){
        const data = (QRErrorCorrectLevel[this.errorCorrectionLevel] << 3) | maskPattern;
        const bits = QRUtil.getBCHTypeInfo(data);
        // vertical
        for(let i=0;i<15;i++){
          const mod = (!test && ((bits >> i) & 1) === 1);
          if(i < 6) this.modules[i][8] = mod;
          else if(i < 8) this.modules[i + 1][8] = mod;
          else this.modules[this.moduleCount - 15 + i][8] = mod;
        }
        // horizontal
        for(let i=0;i<15;i++){
          const mod = (!test && ((bits >> i) & 1) === 1);
          if(i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
          else if(i < 9) this.modules[8][15 - i - 1 + 1] = mod;
          else this.modules[8][15 - i - 1] = mod;
        }
        this.modules[this.moduleCount - 8][8] = (!test);
      },
      _createData: function(){
        const rsBlocks = QRRSBlock.getRSBlocks(this.typeNumber, this.errorCorrectionLevel);
        const buffer = new QRBitBuffer();
        for(const d of this.dataList){
          buffer.put(d.mode, 4);
          buffer.put(d.getLength(), QRUtil.getLengthInBits(this.typeNumber));
          d.write(buffer);
        }
        const totalDataCount = rsBlocks.reduce((a,b)=> a + b.dataCount, 0);
        // terminator
        if(buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
        // pad to byte
        while(buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
        // pad bytes
        const PAD0 = 0xEC, PAD1 = 0x11;
        while(buffer.getLengthInBits() < totalDataCount * 8){
          buffer.put(PAD0, 8);
          if(buffer.getLengthInBits() >= totalDataCount * 8) break;
          buffer.put(PAD1, 8);
        }
        // create bytes
        let offset = 0;
        const data = [];
        const ec = [];
        let maxDc = 0, maxEc = 0;
        for(const b of rsBlocks){
          const dcCount = b.dataCount;
          const ecCount = b.totalCount - b.dataCount;
          maxDc = Math.max(maxDc, dcCount);
          maxEc = Math.max(maxEc, ecCount);
          const dc = new Array(dcCount);
          for(let i=0;i<dc.length;i++) dc[i] = 0xff & buffer.buffer[i + offset];
          offset += dcCount;
          const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
          const rawPoly = new QRPolynomial(dc, rsPoly.getLength() - 1);
          const modPoly = rawPoly.mod(rsPoly);
          const ecBytes = new Array(ecCount);
          for(let i=0;i<ecBytes.length;i++){
            const modIndex = i + modPoly.getLength() - ecBytes.length;
            ecBytes[i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
          }
          data.push(dc);
          ec.push(ecBytes);
        }
        const total = [];
        for(let i=0;i<maxDc;i++){
          for(let r=0;r<data.length;r++){
            if(i < data[r].length) total.push(data[r][i]);
          }
        }
        for(let i=0;i<maxEc;i++){
          for(let r=0;r<ec.length;r++){
            if(i < ec[r].length) total.push(ec[r][i]);
          }
        }
        return total;
      },
      _mapData: function(data, maskPattern){
        let inc = -1;
        let row = this.moduleCount - 1;
        let bitIndex = 7;
        let byteIndex = 0;
        for(let col=this.moduleCount - 1; col>0; col -= 2){
          if(col === 6) col--;
          while(true){
            for(let c=0;c<2;c++){
              if(this.modules[row][col - c] === null){
                let dark = false;
                if(byteIndex < data.length){
                  dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
                }
                const mask = QRUtil.getMask(maskPattern, row, col - c);
                this.modules[row][col - c] = mask ? !dark : dark;
                bitIndex--;
                if(bitIndex === -1){
                  byteIndex++;
                  bitIndex = 7;
                }
              }
            }
            row += inc;
            if(row < 0 || this.moduleCount <= row){
              row -= inc;
              inc = -inc;
              break;
            }
          }
        }
      },
      _getLostPoint: function(){
        // simplified lost point calculation (good enough for small codes)
        let lostPoint = 0;
        const moduleCount = this.moduleCount;
        for(let row=0; row<moduleCount; row++){
          for(let col=0; col<moduleCount; col++){
            const dark = this.modules[row][col];
            // count adjacent
            let sameCount = 0;
            for(let r=-1;r<=1;r++){
              if(row + r < 0 || moduleCount <= row + r) continue;
              for(let c=-1;c<=1;c++){
                if(col + c < 0 || moduleCount <= col + c) continue;
                if(r === 0 && c === 0) continue;
                if(dark === this.modules[row + r][col + c]) sameCount++;
              }
            }
            if(sameCount > 5) lostPoint += (3 + sameCount - 5);
          }
        }
        return lostPoint;
      }
    };
    return qr;
  }

  global.qrcode = qrcode;
})(typeof window !== "undefined" ? window : globalThis);

